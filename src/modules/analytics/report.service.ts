import type { OrderStatus } from '@generated/prisma';

import { db } from '@/modules/core';

/**
 * The store's reporting queries (P15). Read-only, by rule and by test —
 * see `read-only.test.ts`, which runs every function here against a client
 * that throws on any write.
 *
 * ## What these numbers are, and what they are not
 *
 * **Revenue counts paid orders only.** An order's `paymentStatus` is the
 * only fact in this database that says money actually arrived; `status`
 * says where the order is in fulfilment, which is a different question. So
 * revenue, average order value and units sold all sum over
 * `paymentStatus = 'PAID'`, and a cancelled or unpaid order contributes
 * nothing. `placedOrderCount` counts everything placed, so the two numbers
 * together say "this many orders, this many of them paid" rather than
 * implying one figure covers both.
 *
 * **Refunds are counted, not subtracted.** `PaymentStatus` records *that*
 * an order was refunded and never *how much* — there is no refund amount
 * anywhere in the schema. Netting refunds out of revenue would therefore
 * mean inventing a number, so this reports refunded and partially-refunded
 * order counts alongside the revenue instead, and the screen says so.
 *
 * **There is no views metric.** `ProductView` and `DailyProductStats`
 * exist in the schema and nothing anywhere writes to them (the storefront's
 * "recently viewed" is `localStorage`, see `lib/recently-viewed.ts`), so a
 * views panel would show zero forever. It is left unbuilt rather than
 * shipped empty.
 *
 * **Days are UTC days.** `orders.placed_at` is `TIMESTAMP(3)` without a
 * zone and Prisma writes UTC into it, so `date_trunc` below buckets by UTC
 * day. Consistent, and the only bucketing the stored data actually
 * supports.
 */

export interface ReportRange {
  from: Date;
  /** Exclusive, so a day never lands in two buckets and "the last 30 days"
   * is exactly 30 of them. */
  to: Date;
}

export interface ReportTotals {
  paidRevenueMinor: number;
  paidOrderCount: number;
  averageOrderValueMinor: number;
  unitsSold: number;
  newCustomerCount: number;
  placedOrderCount: number;
}

export interface RevenueDay {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  revenueMinor: number;
  orderCount: number;
}

export interface TopProduct {
  /** `null` for lines whose product row has since been deleted — the order
   * item's own snapshot still names it, which is the point of the snapshot. */
  productId: string | null;
  nameAr: string;
  nameEn: string;
  unitsSold: number;
  revenueMinor: number;
}

export interface StatusSlice {
  status: OrderStatus;
  count: number;
}

export interface CouponUsage {
  code: string;
  redemptions: number;
  discountMinor: number;
}

export interface SalesReport {
  range: ReportRange;
  totals: ReportTotals;
  /** The immediately preceding window of the same length, for the deltas.
   * Same window length, so "last 30 days" is compared with the 30 before
   * it rather than with a calendar month of a different size. */
  previous: ReportTotals;
  revenueByDay: RevenueDay[];
  topProducts: TopProduct[];
  ordersByStatus: StatusSlice[];
  coupons: CouponUsage[];
  refundedOrderCount: number;
  partiallyRefundedOrderCount: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TOP_PRODUCT_LIMIT = 10;
const TOP_COUPON_LIMIT = 10;

/**
 * "The last N days", as whole UTC days.
 *
 * The range every screen actually wants: `from` is midnight at the start of
 * the first day and `to` is midnight after today, so the report contains
 * exactly N daily buckets and today is one of them. A range built by
 * subtracting milliseconds from "now" instead would start mid-afternoon and
 * straddle N+1 calendar days, giving a chart with two half-height end bars
 * that look like a collapse in trade.
 */
export function lastNDaysRange(days: number, now: Date = new Date()): ReportRange {
  const endOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return {
    from: new Date(endOfToday - days * MS_PER_DAY),
    to: new Date(endOfToday),
  };
}

/** The window immediately before `range`, of identical length. */
export function previousRange(range: ReportRange): ReportRange {
  const span = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - span), to: range.from };
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function loadTotals(range: ReportRange): Promise<ReportTotals> {
  const placedWhere = { placedAt: { gte: range.from, lt: range.to } };
  const paidWhere = { ...placedWhere, paymentStatus: 'PAID' as const };

  const [paid, placedOrderCount, units, newCustomerCount] = await Promise.all([
    db.order.aggregate({ where: paidWhere, _sum: { totalMinor: true }, _count: { _all: true } }),
    db.order.count({ where: placedWhere }),
    db.orderItem.aggregate({ where: { order: paidWhere }, _sum: { quantity: true } }),
    db.customer.count({ where: { createdAt: { gte: range.from, lt: range.to } } }),
  ]);

  const paidRevenueMinor = paid._sum.totalMinor ?? 0;
  const paidOrderCount = paid._count._all;

  return {
    paidRevenueMinor,
    paidOrderCount,
    // Integer minor units throughout (ADR-006): the average is rounded here
    // rather than carried as a float that a formatter would round anyway.
    averageOrderValueMinor:
      paidOrderCount === 0 ? 0 : Math.round(paidRevenueMinor / paidOrderCount),
    unitsSold: units._sum.quantity ?? 0,
    newCustomerCount,
    placedOrderCount,
  };
}

/**
 * Revenue per UTC day, with the empty days filled in.
 *
 * Grouped in the database rather than by fetching every order and bucketing
 * in memory — a year of orders is not a page of them. Days with no paid
 * order come back missing from SQL and are added as zeroes here, because a
 * chart that silently skips its quiet days draws a misleading slope.
 */
async function loadRevenueByDay(range: ReportRange): Promise<RevenueDay[]> {
  const rows = await db.$queryRaw<{ day: Date; revenue: bigint; orders: bigint }[]>`
    SELECT date_trunc('day', "placed_at") AS day,
           SUM("total_minor")::bigint     AS revenue,
           COUNT(*)::bigint               AS orders
    FROM "orders"
    WHERE "payment_status" = 'PAID'::"PaymentStatus"
      AND "placed_at" >= ${range.from}
      AND "placed_at" < ${range.to}
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  const byDay = new Map(
    rows.map((row) => [
      utcDayKey(row.day),
      { revenueMinor: Number(row.revenue), orderCount: Number(row.orders) },
    ]),
  );

  const days: RevenueDay[] = [];
  const cursor = new Date(
    Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), range.from.getUTCDate()),
  );

  while (cursor < range.to) {
    const key = utcDayKey(cursor);
    const found = byDay.get(key);
    days.push({
      date: key,
      revenueMinor: found?.revenueMinor ?? 0,
      orderCount: found?.orderCount ?? 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

/**
 * Best sellers, by revenue from paid orders.
 *
 * Grouped by `productId` so a product with several variants counts once.
 * The display name comes from the order item's own snapshot rather than
 * from the `Product` row: the snapshot is what the customer actually
 * bought under, it survives a rename or a deletion, and reading `Product`
 * here would mean `analytics` depending on `catalog`, which the module
 * graph does not allow.
 */
async function loadTopProducts(range: ReportRange): Promise<TopProduct[]> {
  const paidWhere = {
    order: { placedAt: { gte: range.from, lt: range.to }, paymentStatus: 'PAID' as const },
  };

  const grouped = await db.orderItem.groupBy({
    by: ['productId'],
    where: paidWhere,
    _sum: { quantity: true, lineTotalMinor: true },
    orderBy: { _sum: { lineTotalMinor: 'desc' } },
    take: TOP_PRODUCT_LIMIT,
  });

  return Promise.all(
    grouped.map(async (group) => {
      const sample = await db.orderItem.findFirst({
        where: { ...paidWhere, productId: group.productId },
        orderBy: { order: { placedAt: 'desc' } },
        select: { productNameArSnapshot: true, productNameEnSnapshot: true },
      });

      return {
        productId: group.productId,
        nameAr: sample?.productNameArSnapshot ?? '',
        nameEn: sample?.productNameEnSnapshot ?? '',
        unitsSold: group._sum.quantity ?? 0,
        revenueMinor: group._sum.lineTotalMinor ?? 0,
      };
    }),
  );
}

/** Every order placed in the window, by its order status — all of them, not
 * only the paid ones: "how many are still waiting on payment" is exactly
 * what this panel is for. */
async function loadOrdersByStatus(range: ReportRange): Promise<StatusSlice[]> {
  const grouped = await db.order.groupBy({
    by: ['status'],
    where: { placedAt: { gte: range.from, lt: range.to } },
    _count: { _all: true },
  });

  return grouped
    .map((group) => ({ status: group.status, count: group._count._all }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Coupon usage, from the orders themselves.
 *
 * `Order.couponCode` is the code as typed at checkout and is kept even if
 * the coupon row is later deleted, so this reports what customers actually
 * used rather than what still exists in the promotions screen.
 * `Order.discountMinor` is the whole order discount; where a coupon was
 * applied it is that coupon's effect.
 */
async function loadCoupons(range: ReportRange): Promise<CouponUsage[]> {
  const grouped = await db.order.groupBy({
    by: ['couponCode'],
    where: {
      placedAt: { gte: range.from, lt: range.to },
      paymentStatus: 'PAID',
      couponCode: { not: null },
    },
    _count: { _all: true },
    _sum: { discountMinor: true },
    orderBy: { _sum: { discountMinor: 'desc' } },
    take: TOP_COUPON_LIMIT,
  });

  return grouped.map((group) => ({
    code: group.couponCode ?? '',
    redemptions: group._count._all,
    discountMinor: group._sum.discountMinor ?? 0,
  }));
}

export async function getSalesReport(range: ReportRange): Promise<SalesReport> {
  const previousWindow = previousRange(range);

  const [
    totals,
    previous,
    revenueByDay,
    topProducts,
    ordersByStatus,
    coupons,
    refundedOrderCount,
    partiallyRefundedOrderCount,
  ] = await Promise.all([
    loadTotals(range),
    loadTotals(previousWindow),
    loadRevenueByDay(range),
    loadTopProducts(range),
    loadOrdersByStatus(range),
    loadCoupons(range),
    db.order.count({
      where: { placedAt: { gte: range.from, lt: range.to }, paymentStatus: 'REFUNDED' },
    }),
    db.order.count({
      where: { placedAt: { gte: range.from, lt: range.to }, paymentStatus: 'PARTIALLY_REFUNDED' },
    }),
  ]);

  return {
    range,
    totals,
    previous,
    revenueByDay,
    topProducts,
    ordersByStatus,
    coupons,
    refundedOrderCount,
    partiallyRefundedOrderCount,
  };
}

/**
 * Percentage change between two periods, or `null` when there is nothing to
 * compare against.
 *
 * `null` rather than `0` or `100` when the previous period was empty: a
 * store's first week has no meaningful percentage change, and "+100%"
 * against zero is a number that looks like information and isn't. The KPI
 * card simply omits the delta.
 */
export function percentageChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
