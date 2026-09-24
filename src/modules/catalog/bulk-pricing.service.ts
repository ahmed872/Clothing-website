import { z } from 'zod';

import { db, AppError } from '@/modules/core';

import { assertPricingInvariants } from './schemas';

/**
 * Changing many variants' prices at once (P08 §8).
 *
 * Lives in `catalog` rather than `pricing` on purpose: this writes
 * `Variant.priceMinor`, a catalog column. The `pricing` module is P09's
 * discount/coupon/total engine and owns no catalog rows — putting this
 * there would give two modules write access to the same field.
 *
 * The same computation backs both halves of the flow: `previewBulkPrice`
 * returns exactly what `applyBulkPrice` will write, so the numbers an admin
 * confirms are the numbers that land, and a percentage is never rounded
 * twice into a different answer.
 */

export const bulkPriceOperationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('absolute'),
    /** The price every selected variant ends up at, in minor units. */
    priceMinor: z.number().int().nonnegative().max(1_000_000_000),
  }),
  z.object({
    kind: z.literal('percentage'),
    /** `+5` raises by 5%, `-10` cuts by 10%. */
    percent: z.number().min(-99).max(1000),
  }),
]);

export type BulkPriceOperation = z.infer<typeof bulkPriceOperationSchema>;

export const bulkPriceInputSchema = z.object({
  variantIds: z.array(z.string().uuid()).min(1).max(500),
  operation: bulkPriceOperationSchema,
});

export type BulkPriceInput = z.infer<typeof bulkPriceInputSchema>;

export interface BulkPriceRow {
  variantId: string;
  sku: string;
  productNameAr: string;
  productNameEn: string;
  currentPriceMinor: number;
  newPriceMinor: number;
  compareAtMinor: number | null;
  /** Set when this row cannot be written — the preview shows it as blocked
   * and `applyBulkPrice` refuses the whole batch rather than skipping it. */
  problemReasonCode: string | null;
}

export interface BulkPricePreview {
  rows: BulkPriceRow[];
  /** Rows whose new price would break a pricing invariant. */
  blockedCount: number;
}

/**
 * A percentage change rounds to the nearest minor unit — half away from
 * zero, so a 5% rise on 1005 halalas is 1055 rather than a banker's 1054.
 * Rounding once, here, is what keeps preview and apply identical.
 */
function computeNewPrice(currentMinor: number, operation: BulkPriceOperation): number {
  if (operation.kind === 'absolute') return operation.priceMinor;
  const raw = currentMinor * (1 + operation.percent / 100);
  return Math.max(0, Math.round(raw));
}

async function loadRows(variantIds: string[]): Promise<BulkPriceRow[]> {
  const variants = await db.variant.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      sku: true,
      priceMinor: true,
      compareAtMinor: true,
      salePriceMinor: true,
      saleStartsAt: true,
      saleEndsAt: true,
      product: { select: { nameAr: true, nameEn: true } },
    },
    orderBy: { sku: 'asc' },
  });

  if (variants.length !== variantIds.length) {
    throw new AppError('NOT_FOUND', {
      internalMessage: 'One or more variants in the bulk selection no longer exist',
      details: { entity: 'Variant', reasonCode: 'bulk_variant_missing' },
    });
  }

  return variants.map((variant) => ({
    variantId: variant.id,
    sku: variant.sku,
    productNameAr: variant.product.nameAr,
    productNameEn: variant.product.nameEn,
    currentPriceMinor: variant.priceMinor,
    newPriceMinor: variant.priceMinor,
    compareAtMinor: variant.compareAtMinor,
    problemReasonCode: null,
  }));
}

function applyOperation(
  rows: BulkPriceRow[],
  operation: BulkPriceOperation,
  stored: Map<string, { salePriceMinor: number | null }>,
): BulkPriceRow[] {
  return rows.map((row) => {
    const newPriceMinor = computeNewPrice(row.currentPriceMinor, operation);
    const invariants = assertPricingInvariants({
      priceMinor: newPriceMinor,
      compareAtMinor: row.compareAtMinor,
      salePriceMinor: stored.get(row.variantId)?.salePriceMinor ?? null,
    });

    return {
      ...row,
      newPriceMinor,
      problemReasonCode: invariants.ok ? null : invariants.reasonCode,
    };
  });
}

async function storedSalePrices(
  variantIds: string[],
): Promise<Map<string, { salePriceMinor: number | null }>> {
  const rows = await db.variant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, salePriceMinor: true },
  });
  return new Map(rows.map((row) => [row.id, { salePriceMinor: row.salePriceMinor }]));
}

/** What the change would do, before anything is written. */
export async function previewBulkPrice(input: BulkPriceInput): Promise<BulkPricePreview> {
  const parsed = bulkPriceInputSchema.parse(input);
  const rows = applyOperation(
    await loadRows(parsed.variantIds),
    parsed.operation,
    await storedSalePrices(parsed.variantIds),
  );

  return { rows, blockedCount: rows.filter((row) => row.problemReasonCode !== null).length };
}

export interface BulkPriceResult {
  updated: number;
  rows: BulkPriceRow[];
}

/**
 * Applies the change to every selected variant in one transaction.
 *
 * All-or-nothing (P08 §8): if any row would break a pricing invariant the
 * batch is refused before a single write, and any database failure part-way
 * rolls the rest back. A half-applied price change across a category is
 * worse than no change at all — it is the kind of state nobody can tell
 * apart from a deliberate one.
 *
 * The prices are re-read and re-computed inside the transaction rather than
 * trusting numbers the client sends back from its preview, so a stale
 * preview can never write a price nobody approved.
 */
export async function applyBulkPrice(input: BulkPriceInput): Promise<BulkPriceResult> {
  const parsed = bulkPriceInputSchema.parse(input);

  return db.$transaction(async (tx) => {
    const variants = await tx.variant.findMany({
      where: { id: { in: parsed.variantIds } },
      select: {
        id: true,
        sku: true,
        priceMinor: true,
        compareAtMinor: true,
        salePriceMinor: true,
        product: { select: { nameAr: true, nameEn: true } },
      },
      orderBy: { sku: 'asc' },
    });

    if (variants.length !== parsed.variantIds.length) {
      throw new AppError('NOT_FOUND', {
        internalMessage: 'One or more variants in the bulk selection no longer exist',
        details: { entity: 'Variant', reasonCode: 'bulk_variant_missing' },
      });
    }

    const rows: BulkPriceRow[] = variants.map((variant) => {
      const newPriceMinor = computeNewPrice(variant.priceMinor, parsed.operation);
      const invariants = assertPricingInvariants({
        priceMinor: newPriceMinor,
        compareAtMinor: variant.compareAtMinor,
        salePriceMinor: variant.salePriceMinor,
      });
      return {
        variantId: variant.id,
        sku: variant.sku,
        productNameAr: variant.product.nameAr,
        productNameEn: variant.product.nameEn,
        currentPriceMinor: variant.priceMinor,
        newPriceMinor,
        compareAtMinor: variant.compareAtMinor,
        problemReasonCode: invariants.ok ? null : invariants.reasonCode,
      };
    });

    const blocked = rows.filter((row) => row.problemReasonCode !== null);
    if (blocked.length > 0) {
      throw new AppError('VALIDATION_FAILED', {
        internalMessage: `Bulk price refused: ${blocked.length} variant(s) would break a pricing invariant`,
        details: {
          reasonCode: 'bulk_price_blocked',
          count: blocked.length,
          skus: blocked.slice(0, 5).map((row) => row.sku),
        },
      });
    }

    for (const row of rows) {
      await tx.variant.update({
        where: { id: row.variantId },
        data: { priceMinor: row.newPriceMinor },
      });
    }

    return { updated: rows.length, rows };
  });
}

/** The products the given variants belong to — what a caller needs in order
 * to revalidate the right storefront pages after a bulk change, without
 * loading every variant again. */
export async function productsForVariants(
  variantIds: string[],
): Promise<{ id: string; slug: string; categoryId: string }[]> {
  const variants = await db.variant.findMany({
    where: { id: { in: variantIds } },
    select: { product: { select: { id: true, slug: true, categoryId: true } } },
  });

  const byId = new Map(variants.map((variant) => [variant.product.id, variant.product]));
  return [...byId.values()];
}
