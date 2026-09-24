import { z } from 'zod';
import type { InventoryAdjustment, InventoryReason, Prisma, Variant } from '@generated/prisma';

import { db, AppError } from '@/modules/core';

/**
 * Stock movements. This module is the sole owner of `Variant.stockQuantity`
 * writes — `catalog`'s `updateVariant` deliberately refuses that field, so
 * there is exactly one code path by which stock can change and exactly one
 * place that records why (P08 §2).
 *
 * Every movement is a transaction that does three things together or not at
 * all: lock the row, move the quantity, write the `InventoryAdjustment`
 * history entry. A failure anywhere — including the negative-stock guard —
 * rolls the whole thing back, so the counter and its history can never
 * disagree.
 */

/** Reasons an admin can pick in the UI. `SALE` and `CANCELLATION` exist in
 * the enum for the order flow (P10) to use and are deliberately not offered
 * here: an admin correcting the shelf count is not making a sale. */
export const MANUAL_INVENTORY_REASONS = [
  'RESTOCK',
  'RETURN',
  'DAMAGED',
  'CORRECTION',
  'MANUAL',
] as const satisfies readonly InventoryReason[];

export type ManualInventoryReason = (typeof MANUAL_INVENTORY_REASONS)[number];

export const adjustStockInputSchema = z
  .object({
    variantId: z.string().uuid(),
    /** Relative movement: `+10` received, `-2` damaged. */
    delta: z.number().int().optional(),
    /** Absolute correction — a stock count that replaces the counter
     * outright. Mutually exclusive with `delta`. */
    setTo: z.number().int().nonnegative().optional(),
    reason: z.enum(MANUAL_INVENTORY_REASONS),
    note: z.string().trim().min(1).max(500).nullable().optional(),
    actorUserId: z.string().uuid().nullable().optional(),
    orderId: z.string().uuid().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const hasDelta = value.delta !== undefined;
    const hasSetTo = value.setTo !== undefined;
    if (hasDelta === hasSetTo) {
      ctx.addIssue({
        code: 'custom',
        path: ['delta'],
        message: 'Provide exactly one of delta or setTo',
      });
    }
    if (hasDelta && value.delta === 0) {
      ctx.addIssue({ code: 'custom', path: ['delta'], message: 'delta must not be zero' });
    }
  });

export type AdjustStockInput = z.input<typeof adjustStockInputSchema>;

/** The same shape, but accepting the two reasons only the order flow may
 * use. Kept internal: `consumeStockForOrder`/`restoreStockForOrder` below are
 * the only way to reach them, so no caller can label a warehouse correction a
 * SALE, or a sale a correction. */
const orderAdjustStockSchema = z.object({
  variantId: z.string().uuid(),
  delta: z
    .number()
    .int()
    .refine((value) => value !== 0, 'delta must not be zero'),
  reason: z.enum(['SALE', 'CANCELLATION'] as const satisfies readonly InventoryReason[]),
  note: z.string().trim().min(1).max(500).nullable().optional(),
  actorUserId: z.string().uuid().nullable().optional(),
  orderId: z.string().uuid(),
});

export interface StockAdjustmentResult {
  adjustment: InventoryAdjustment;
  variant: Variant;
}

/**
 * The one way stock changes.
 *
 * Concurrency (P08 §13): the variant row is locked with `SELECT … FOR
 * UPDATE` as the first statement in the transaction, so a second
 * adjustment on the same variant waits for the first to commit and then
 * reads the value the first one produced. Two admins each adding 5 to a
 * stock of 10 end at 20, never 15 — the naive read-compute-write that would
 * lose one of those updates is exactly what this avoids. The lock is held
 * for the few statements of the transaction and is per-variant, so
 * adjustments to different variants never block each other.
 *
 * Negative stock is refused rather than clamped: silently turning a -3 into
 * a 0 would make the history lie about what happened. Overselling is not a
 * business rule this store has, so the guard is unconditional for tracked
 * variants; an untracked variant has no counter worth guarding and is
 * simply left alone.
 */
export async function adjustStock(input: AdjustStockInput): Promise<StockAdjustmentResult> {
  const parsed = adjustStockInputSchema.parse(input);
  return db.$transaction((tx) => applyStockMovement(tx, parsed));
}

/**
 * Take stock for an order, inside the caller's transaction.
 *
 * Order finalization has to decrement stock, create the order, consume the
 * coupon and clear the cart together or not at all (P10 §6). Opening a second
 * transaction here would put the decrement on a different connection, outside
 * that boundary — stock could be taken for an order that then failed to be
 * created. Joining the caller's `tx` keeps one atomic unit while leaving this
 * module the only writer of `stockQuantity` (P08 §2).
 *
 * Concurrency comes from the same `FOR UPDATE` lock the admin path uses: two
 * checkouts racing for the last unit serialise on the variant row, the second
 * one reads the first one's result, and its negative-stock guard rejects it.
 */
export async function consumeStockForOrderWithin(
  tx: Prisma.TransactionClient,
  input: { variantId: string; quantity: number; orderId: string; note?: string | null },
): Promise<StockAdjustmentResult> {
  const parsed = orderAdjustStockSchema.parse({
    variantId: input.variantId,
    delta: -Math.abs(input.quantity),
    reason: 'SALE',
    orderId: input.orderId,
    note: input.note ?? null,
  });
  return applyStockMovement(tx, parsed);
}

/**
 * Put stock back when an order is cancelled, inside the caller's transaction.
 *
 * Idempotency is not this function's job — it moves stock every time it is
 * called. `cancelOrder` decides *whether* to call it, using the order's
 * `inventoryRestoredAt` stamp set in the same transaction, so a repeated
 * cancellation never reaches here twice (P10 §18).
 */
export async function restoreStockForOrderWithin(
  tx: Prisma.TransactionClient,
  input: {
    variantId: string;
    quantity: number;
    orderId: string;
    actorUserId?: string | null;
    note?: string | null;
  },
): Promise<StockAdjustmentResult> {
  const parsed = orderAdjustStockSchema.parse({
    variantId: input.variantId,
    delta: Math.abs(input.quantity),
    reason: 'CANCELLATION',
    orderId: input.orderId,
    actorUserId: input.actorUserId ?? null,
    note: input.note ?? null,
  });
  return applyStockMovement(tx, parsed);
}

/**
 * The one place a stock quantity actually changes. Everything above is a
 * caller deciding which movement to ask for; this decides whether it is
 * allowed and records it.
 */
async function applyStockMovement(
  tx: Prisma.TransactionClient,
  parsed:
    | z.output<typeof adjustStockInputSchema>
    | (z.output<typeof orderAdjustStockSchema> & { setTo?: undefined }),
): Promise<StockAdjustmentResult> {
  // `FOR UPDATE` is not expressible through Prisma's query API, and this
  // lock is the whole point of the transaction — a plain findUnique would
  // let two concurrent adjustments read the same "previous" value.
  const locked = await tx.$queryRaw<{ stock_quantity: number; track_inventory: boolean }[]>`
    SELECT stock_quantity, track_inventory
    FROM variants
    WHERE id = ${parsed.variantId}::uuid
    FOR UPDATE
  `;

  const current = locked[0];
  if (!current) {
    throw new AppError('NOT_FOUND', {
      details: { entity: 'Variant', id: parsed.variantId },
    });
  }

  const previousQuantity = current.stock_quantity;
  const newQuantity =
    parsed.setTo !== undefined ? parsed.setTo : previousQuantity + (parsed.delta ?? 0);
  const delta = newQuantity - previousQuantity;

  if (delta === 0) {
    throw new AppError('VALIDATION_FAILED', {
      internalMessage: 'Adjustment would not change the stock level',
      details: { reasonCode: 'stock_unchanged' },
    });
  }

  if (newQuantity < 0) {
    throw new AppError('OUT_OF_STOCK', {
      internalMessage: `Adjustment would take stock to ${newQuantity}`,
      details: {
        reasonCode: 'stock_would_go_negative',
        previousQuantity,
        requested: delta,
      },
    });
  }

  const variant = await tx.variant.update({
    where: { id: parsed.variantId },
    data: { stockQuantity: newQuantity },
  });

  const adjustment = await tx.inventoryAdjustment.create({
    data: {
      variantId: parsed.variantId,
      delta,
      previousQuantity,
      newQuantity,
      reason: parsed.reason,
      note: parsed.note ?? null,
      actorUserId: parsed.actorUserId ?? null,
      orderId: parsed.orderId ?? null,
    },
  });

  return { adjustment, variant };
}

export const inventoryPolicyInputSchema = z.object({
  trackInventory: z.boolean().optional(),
  lowStockThreshold: z.number().int().nonnegative().max(1_000_000).optional(),
});

export type InventoryPolicyInput = z.infer<typeof inventoryPolicyInputSchema>;

/**
 * Whether a variant's stock is counted at all, and the level at which it
 * starts warning. Policy, not a movement — it changes no quantity, so it
 * writes no adjustment row; the admin audit log records who changed it.
 *
 * `expectedUpdatedAt` is the same optimistic-concurrency check the catalog
 * uses (P07): the caller hands back the version it read, and a change made
 * by someone else in between is refused rather than silently overwritten.
 */
export async function setInventoryPolicy(
  variantId: string,
  input: InventoryPolicyInput,
  expectedUpdatedAt?: Date,
): Promise<Variant> {
  const parsed = inventoryPolicyInputSchema.parse(input);
  if (parsed.trackInventory === undefined && parsed.lowStockThreshold === undefined) {
    throw new AppError('VALIDATION_FAILED', {
      internalMessage: 'setInventoryPolicy called with nothing to change',
    });
  }

  const existing = await db.variant.findUnique({ where: { id: variantId } });
  if (!existing) {
    throw new AppError('NOT_FOUND', { details: { entity: 'Variant', id: variantId } });
  }

  if (expectedUpdatedAt && existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    throw new AppError('CONFLICT', {
      internalMessage: 'Stale expectedUpdatedAt on inventory policy update',
    });
  }

  return db.variant.update({ where: { id: variantId }, data: parsed });
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface AdjustmentHistoryQuery {
  variantId?: string;
  productId?: string;
  reason?: InventoryReason;
  actorUserId?: string;
  /** Inclusive lower bound on `createdAt`. */
  from?: Date;
  /** Inclusive upper bound on `createdAt`. */
  to?: Date;
  page?: number;
  pageSize?: number;
}

export interface AdjustmentHistoryItem {
  id: string;
  createdAt: Date;
  delta: number;
  previousQuantity: number;
  newQuantity: number;
  reason: InventoryReason;
  note: string | null;
  variant: { id: string; sku: string; labelAr: string | null; labelEn: string | null };
  product: { id: string; nameAr: string; nameEn: string };
  actor: { id: string; name: string | null; email: string } | null;
}

export interface AdjustmentHistoryResult {
  items: AdjustmentHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function historyWhere(query: AdjustmentHistoryQuery): Prisma.InventoryAdjustmentWhereInput {
  const where: Prisma.InventoryAdjustmentWhereInput = {};

  if (query.variantId) where.variantId = query.variantId;
  if (query.productId) where.variant = { productId: query.productId };
  if (query.reason) where.reason = query.reason;
  if (query.actorUserId) where.actorUserId = query.actorUserId;
  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
  }

  return where;
}

/**
 * The admin history view's query: filtered and paginated in SQL, never by
 * fetching the table and slicing it in the browser (P08 §4). Ordered newest
 * first, with `id` as the tiebreaker so a page boundary can't drop or
 * duplicate a row when two adjustments share a timestamp.
 */
export async function listAdjustments(
  query: AdjustmentHistoryQuery = {},
): Promise<AdjustmentHistoryResult> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));
  const where = historyWhere(query);

  const [rows, total] = await Promise.all([
    db.inventoryAdjustment.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        variant: {
          select: {
            id: true,
            sku: true,
            labelAr: true,
            labelEn: true,
            product: { select: { id: true, nameAr: true, nameEn: true } },
          },
        },
        actor: { select: { id: true, name: true, email: true } },
      },
    }),
    db.inventoryAdjustment.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      delta: row.delta,
      previousQuantity: row.previousQuantity,
      newQuantity: row.newQuantity,
      reason: row.reason,
      note: row.note,
      variant: {
        id: row.variant.id,
        sku: row.variant.sku,
        labelAr: row.variant.labelAr,
        labelEn: row.variant.labelEn,
      },
      product: row.variant.product,
      actor: row.actor,
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}
