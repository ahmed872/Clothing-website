import type { Coupon, CouponScope, Prisma } from '@generated/prisma';

import { db, AppError } from '@/modules/core';

import { couponInputSchema, normalizeCouponCode, type CouponInput } from './coupon-schemas';
import { evaluateCoupon, type CouponEvaluation, type CouponForEvaluation } from './coupon-rules';
import type { PricingLineInput } from './cart-pricing';
import { mapUniqueConstraint } from './prisma-errors';

/**
 * Promotions: what an admin manages, and what a cart asks about.
 *
 * The rules themselves live in `coupon-rules.ts` and are pure; this file is
 * the part that talks to the database — loading a coupon by its code,
 * counting redemptions, and (for P10) consuming a usage slot safely.
 */

export type CouponWithScopes = Coupon & { scopes: CouponScope[] };

export async function getCouponByCode(code: string): Promise<CouponWithScopes | null> {
  return db.coupon.findUnique({
    where: { code: normalizeCouponCode(code) },
    include: { scopes: true },
  });
}

export async function getCoupon(id: string): Promise<CouponWithScopes | null> {
  return db.coupon.findUnique({ where: { id }, include: { scopes: true } });
}

function toEvaluationShape(coupon: Coupon): CouponForEvaluation {
  return {
    id: coupon.id,
    code: coupon.code,
    type: coupon.type,
    value: coupon.value,
    minOrderMinor: coupon.minOrderMinor,
    maxDiscountMinor: coupon.maxDiscountMinor,
    usageLimit: coupon.usageLimit,
    perCustomerLimit: coupon.perCustomerLimit,
    startsAt: coupon.startsAt,
    endsAt: coupon.endsAt,
    active: coupon.active,
  };
}

/**
 * "May this code be used on this cart, by this customer, right now."
 *
 * Reads the live redemption counts rather than trusting `usedCount` alone,
 * so a per-customer limit is answered from the rows that actually record
 * redemptions. Never mutates: entering a code into a cart consumes nothing
 * (see `consumeCouponUsage` for the lifecycle).
 */
export async function evaluateCouponForCart(input: {
  code: string;
  lines: readonly PricingLineInput[];
  customerId: string | null;
  now?: Date;
}): Promise<
  | { coupon: CouponWithScopes; evaluation: CouponEvaluation }
  | { coupon: null; evaluation: CouponEvaluation }
> {
  const coupon = await getCouponByCode(input.code);
  if (!coupon) {
    return { coupon: null, evaluation: { ok: false, reason: 'not_found' } };
  }

  const [totalRedemptions, customerRedemptions] = await Promise.all([
    coupon.usageLimit === null ? Promise.resolve(0) : countRedemptions(coupon.id, null),
    coupon.perCustomerLimit === null || input.customerId === null
      ? Promise.resolve(0)
      : countRedemptions(coupon.id, input.customerId),
  ]);

  const evaluation = evaluateCoupon({
    coupon: toEvaluationShape(coupon),
    scopes: coupon.scopes,
    lines: input.lines,
    now: input.now ?? new Date(),
    totalRedemptions,
    customerRedemptions,
  });

  return { coupon, evaluation };
}

/** Redemption rows are the source of truth for "how many times was this
 * used" — `Coupon.usedCount` is a denormalised counter kept in step by
 * `consumeCouponUsage`, useful for listing but never the thing a limit is
 * decided on. */
export async function countRedemptions(
  couponId: string,
  customerId: string | null,
): Promise<number> {
  return db.couponRedemption.count({
    where: { couponId, ...(customerId === null ? {} : { customerId }) },
  });
}

// ---------------------------------------------------------------------------
// Usage lifecycle (P09 §22)
// ---------------------------------------------------------------------------

/**
 * Consumes one usage slot, atomically. **P09 never calls this** — a coupon
 * typed into a cart is checked for eligibility and nothing more.
 *
 * The lifecycle is three distinct things, and conflating them is how coupon
 * systems leak free money or strand codes nobody can use:
 *
 *   eligibility  — "this code would work" (P09, read-only, repeatable)
 *   reservation  — deliberately absent; there is no safe way to release a
 *                  reservation for a cart that is simply abandoned, and a
 *                  broken release is worse than no reservation at all
 *   finalisation — this function, called once by P10 when an order exists
 *
 * `CouponRedemption.orderId` is required by the schema, which is what makes
 * that boundary structural rather than a convention: a redemption cannot be
 * recorded without an order to attach it to.
 *
 * The row lock is what makes the last slot safe. Two checkouts racing for
 * the final usage both read `usedCount = 4` under a naive
 * read-compare-write and both succeed; here the second one waits for the
 * first to commit, re-reads 5, and is refused.
 */
export async function consumeCouponUsage(input: {
  couponId: string;
  customerId: string | null;
  orderId: string;
}): Promise<{ usedCount: number }> {
  return db.$transaction((tx) => consumeCouponUsageWithin(tx, input));
}

/**
 * The same consumption, joined to a transaction the caller already owns.
 *
 * Order finalization needs the redemption row, the stock decrement and the
 * order itself to commit together (P10 §8): a coupon consumed for an order
 * that then failed to save would be a discount the customer never received
 * but can never use again. The `FOR UPDATE` lock on the coupon row is what
 * makes the limit checks safe under concurrency, and it now holds for the
 * whole order transaction rather than a separate short one.
 */
export async function consumeCouponUsageWithin(
  tx: Prisma.TransactionClient,
  input: {
    couponId: string;
    customerId: string | null;
    orderId: string;
  },
): Promise<{ usedCount: number }> {
  const locked = await tx.$queryRaw<
    { usage_limit: number | null; per_customer_limit: number | null; active: boolean }[]
  >`
    SELECT usage_limit, per_customer_limit, active FROM coupons
    WHERE id = ${input.couponId}::uuid FOR UPDATE
  `;
  const coupon = locked[0];
  if (!coupon) {
    throw new AppError('NOT_FOUND', { details: { entity: 'Coupon', id: input.couponId } });
  }
  if (!coupon.active) {
    throw new AppError('COUPON_INVALID', { details: { reasonCode: 'coupon_inactive' } });
  }

  const used = await tx.couponRedemption.count({ where: { couponId: input.couponId } });
  if (coupon.usage_limit !== null && used >= coupon.usage_limit) {
    throw new AppError('COUPON_LIMIT_REACHED', {
      details: { reasonCode: 'coupon_usage_limit_reached' },
    });
  }

  if (coupon.per_customer_limit !== null && input.customerId !== null) {
    const mine = await tx.couponRedemption.count({
      where: { couponId: input.couponId, customerId: input.customerId },
    });
    if (mine >= coupon.per_customer_limit) {
      throw new AppError('COUPON_LIMIT_REACHED', {
        details: { reasonCode: 'coupon_customer_limit_reached' },
      });
    }
  }

  await tx.couponRedemption.create({
    data: {
      couponId: input.couponId,
      customerId: input.customerId,
      orderId: input.orderId,
    },
  });

  const updated = await tx.coupon.update({
    where: { id: input.couponId },
    data: { usedCount: { increment: 1 } },
  });

  return { usedCount: updated.usedCount };
}

// ---------------------------------------------------------------------------
// Admin management
// ---------------------------------------------------------------------------

function scopeCreateData(input: CouponInput) {
  return (input.scopes ?? []).map((scope) => ({
    scopeType: scope.scopeType,
    targetId: scope.targetId,
  }));
}

function couponWriteData(input: CouponInput) {
  return {
    code: input.code,
    type: input.type,
    value: input.value,
    descriptionAr: input.descriptionAr ?? null,
    descriptionEn: input.descriptionEn ?? null,
    minOrderMinor: input.minOrderMinor ?? null,
    maxDiscountMinor: input.maxDiscountMinor ?? null,
    usageLimit: input.usageLimit ?? null,
    perCustomerLimit: input.perCustomerLimit ?? null,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    active: input.active ?? true,
  };
}

export async function createCoupon(input: CouponInput): Promise<CouponWithScopes> {
  const parsed = couponInputSchema.parse(input);
  try {
    return await db.coupon.create({
      data: { ...couponWriteData(parsed), scopes: { create: scopeCreateData(parsed) } },
      include: { scopes: true },
    });
  } catch (error) {
    throw mapUniqueConstraint(error, 'code');
  }
}

/**
 * Replaces the coupon and its scopes in one transaction. Scopes are
 * rewritten wholesale rather than diffed: the admin form submits the
 * complete intended set, and a partial update is how a scope nobody
 * selected survives an edit.
 *
 * `expectedUpdatedAt` is the same optimistic-concurrency check the catalog
 * and inventory screens use (P07/P08): a change made by someone else in
 * between is refused rather than silently overwritten.
 */
export async function updateCoupon(
  id: string,
  input: CouponInput,
  expectedUpdatedAt?: Date,
): Promise<CouponWithScopes> {
  const parsed = couponInputSchema.parse(input);

  return db.$transaction(async (tx) => {
    const existing = await tx.coupon.findUnique({ where: { id } });
    if (!existing) throw new AppError('NOT_FOUND', { details: { entity: 'Coupon', id } });

    if (expectedUpdatedAt && existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw new AppError('CONFLICT', {
        internalMessage: 'Stale expectedUpdatedAt on coupon update',
      });
    }

    await tx.couponScope.deleteMany({ where: { couponId: id } });

    try {
      return await tx.coupon.update({
        where: { id },
        data: { ...couponWriteData(parsed), scopes: { create: scopeCreateData(parsed) } },
        include: { scopes: true },
      });
    } catch (error) {
      throw mapUniqueConstraint(error, 'code');
    }
  });
}

export async function setCouponActive(id: string, active: boolean): Promise<Coupon> {
  const existing = await db.coupon.findUnique({ where: { id } });
  if (!existing) throw new AppError('NOT_FOUND', { details: { entity: 'Coupon', id } });
  return db.coupon.update({ where: { id }, data: { active } });
}

/**
 * Deleting a promotion that has been redeemed would erase the record of a
 * discount somebody actually received, so it is refused; deactivating is
 * the reversible way to take a code out of circulation.
 */
export async function deleteCoupon(id: string): Promise<void> {
  const redemptions = await db.couponRedemption.count({ where: { couponId: id } });
  if (redemptions > 0) {
    throw new AppError('CONFLICT', {
      details: { reasonCode: 'coupon_has_redemptions', count: redemptions },
    });
  }
  await db.coupon.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Admin listing
// ---------------------------------------------------------------------------

export type CouponStatusFilter = 'active' | 'inactive' | 'scheduled' | 'expired';
export type CouponSort = 'created-desc' | 'created-asc' | 'code-asc' | 'ends-asc';

export interface CouponListingQuery {
  q?: string;
  type?: 'PERCENTAGE' | 'FIXED';
  status?: CouponStatusFilter;
  page?: number;
  pageSize?: number;
  sort?: CouponSort;
}

export interface CouponListingItem {
  id: string;
  code: string;
  type: 'PERCENTAGE' | 'FIXED';
  value: number;
  minOrderMinor: number | null;
  usageLimit: number | null;
  usedCount: number;
  redemptionCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
  scopeCount: number;
  updatedAt: Date;
}

export interface CouponListingResult {
  items: CouponListingItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function statusWhere(status: CouponStatusFilter, now: Date): Prisma.CouponWhereInput {
  switch (status) {
    case 'inactive':
      return { active: false };
    case 'scheduled':
      return { active: true, startsAt: { gt: now } };
    case 'expired':
      return { endsAt: { lt: now } };
    case 'active':
      // Live right now: switched on, started, and not yet finished.
      return {
        active: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      };
  }
}

function orderBy(sort: CouponSort | undefined): Prisma.CouponOrderByWithRelationInput[] {
  switch (sort) {
    case 'created-asc':
      return [{ createdAt: 'asc' }, { id: 'asc' }];
    case 'code-asc':
      return [{ code: 'asc' }, { id: 'asc' }];
    case 'ends-asc':
      return [{ endsAt: 'asc' }, { id: 'asc' }];
    case 'created-desc':
    default:
      return [{ createdAt: 'desc' }, { id: 'asc' }];
  }
}

export async function listCoupons(
  query: CouponListingQuery = {},
  now: Date = new Date(),
): Promise<CouponListingResult> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));

  const where: Prisma.CouponWhereInput = {};
  if (query.type) where.type = query.type;
  if (query.status) Object.assign(where, statusWhere(query.status, now));
  if (query.q) {
    where.OR = [
      { code: { contains: query.q, mode: 'insensitive' } },
      { descriptionAr: { contains: query.q, mode: 'insensitive' } },
      { descriptionEn: { contains: query.q, mode: 'insensitive' } },
    ];
  }

  const [rows, total] = await Promise.all([
    db.coupon.findMany({
      where,
      orderBy: orderBy(query.sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { scopes: true, redemptions: true } } },
    }),
    db.coupon.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      code: row.code,
      type: row.type,
      value: row.value,
      minOrderMinor: row.minOrderMinor,
      usageLimit: row.usageLimit,
      usedCount: row.usedCount,
      redemptionCount: row._count.redemptions,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      active: row.active,
      scopeCount: row._count.scopes,
      updatedAt: row.updatedAt,
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}
