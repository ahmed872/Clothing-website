import { beforeEach, describe, expect, it } from 'vitest';

import type { OrderStatus, PaymentStatus } from '@generated/prisma';

import { db } from '@/modules/core';

import { getSalesReport, lastNDaysRange, percentageChange, previousRange } from './report.service';

/**
 * The reporting queries (P15), against real rows.
 *
 * Most of these exist to pin down one decision: **what counts.** An
 * unpaid order, a cancelled order, an order just outside the window and an
 * order in the previous window all have to be excluded from revenue, and
 * each of them is a different mistake to make.
 */

/**
 * The fixtures live in this file rather than in an `analytics/testing.ts`,
 * because `analytics` owns no tables of its own and, more to the point,
 * nothing that ships as part of this module should contain a write. The
 * rows below belong to `orders`, `customers` and `identity`; this test
 * borrows them to have something to report on.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-15T12:00:00.000Z');
/** Seven whole UTC days ending with the 15th — what a screen's "last 7
 * days" filter passes, and the only range shape that yields seven buckets. */
const RANGE = lastNDaysRange(7, NOW);

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

let sequence = 0;

function nextId(): number {
  sequence += 1;
  return sequence;
}

async function resetAnalyticsFixtures(): Promise<void> {
  await db.orderEvent.deleteMany();
  await db.orderItem.deleteMany();
  await db.couponRedemption.deleteMany();
  await db.inventoryAdjustment.deleteMany();
  await db.order.deleteMany();
  await db.customer.deleteMany();
  await db.user.deleteMany();
}

interface SeedItem {
  productId?: string | null;
  quantity?: number;
  lineTotalMinor?: number;
  nameAr?: string;
  nameEn?: string;
}

interface SeedOrderInput {
  placedAt: Date;
  totalMinor: number;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  couponCode?: string;
  discountMinor?: number;
  items?: SeedItem[];
}

async function seedOrder(input: SeedOrderInput) {
  const n = nextId();
  return db.order.create({
    data: {
      number: `TEST-${n}-${Math.floor(Math.random() * 100000)}`,
      status: input.status ?? 'CONFIRMED',
      paymentStatus: input.paymentStatus ?? 'UNPAID',
      subtotalMinor: input.totalMinor + (input.discountMinor ?? 0),
      discountMinor: input.discountMinor ?? 0,
      totalMinor: input.totalMinor,
      couponCode: input.couponCode ?? null,
      placedAt: input.placedAt,
      items: {
        create: (input.items ?? []).map((item, index) => ({
          productId: item.productId ?? null,
          productNameArSnapshot: item.nameAr ?? `منتج ${index}`,
          productNameEnSnapshot: item.nameEn ?? `Product ${index}`,
          skuSnapshot: `SKU-${n}-${index}`,
          unitPriceMinor: item.lineTotalMinor ?? 1000,
          quantity: item.quantity ?? 1,
          lineSubtotalMinor: item.lineTotalMinor ?? 1000,
          lineTotalMinor: item.lineTotalMinor ?? 1000,
        })),
      },
    },
  });
}

function seedPaidOrder(input: SeedOrderInput) {
  return seedOrder({ status: 'COMPLETED', ...input, paymentStatus: 'PAID' });
}

async function seedCustomer(input: { createdAt: Date }) {
  const n = nextId();
  const user = await db.user.create({
    data: { email: `analytics-fixture-${n}@example.com`, role: 'CUSTOMER' },
  });
  return db.customer.create({
    data: { userId: user.id, createdAt: input.createdAt },
  });
}

beforeEach(async () => {
  await resetAnalyticsFixtures();
});

describe('totals', () => {
  it('reports zeroes on an empty store rather than failing', async () => {
    const report = await getSalesReport(RANGE);

    expect(report.totals).toMatchObject({
      paidRevenueMinor: 0,
      paidOrderCount: 0,
      averageOrderValueMinor: 0,
      unitsSold: 0,
      newCustomerCount: 0,
      placedOrderCount: 0,
    });
    expect(report.topProducts).toEqual([]);
    expect(report.ordersByStatus).toEqual([]);
    expect(report.coupons).toEqual([]);
  });

  it('counts paid orders in revenue and every placed order in the order count', async () => {
    await seedPaidOrder({ placedAt: daysAgo(2), totalMinor: 30_000 });
    await seedPaidOrder({ placedAt: daysAgo(1), totalMinor: 10_000 });
    // Placed, but no money arrived — an order, not revenue.
    await seedOrder({ placedAt: daysAgo(1), totalMinor: 99_000, paymentStatus: 'UNPAID' });

    const report = await getSalesReport(RANGE);

    expect(report.totals.paidRevenueMinor).toBe(40_000);
    expect(report.totals.paidOrderCount).toBe(2);
    expect(report.totals.placedOrderCount).toBe(3);
    expect(report.totals.averageOrderValueMinor).toBe(20_000);
  });

  it('excludes a cancelled, refunded or failed order from revenue', async () => {
    await seedPaidOrder({ placedAt: daysAgo(1), totalMinor: 10_000 });
    await seedOrder({
      placedAt: daysAgo(1),
      totalMinor: 50_000,
      status: 'CANCELLED',
      paymentStatus: 'FAILED',
    });
    await seedOrder({ placedAt: daysAgo(1), totalMinor: 70_000, paymentStatus: 'REFUNDED' });
    await seedOrder({
      placedAt: daysAgo(1),
      totalMinor: 20_000,
      paymentStatus: 'PARTIALLY_REFUNDED',
    });

    const report = await getSalesReport(RANGE);

    expect(report.totals.paidRevenueMinor).toBe(10_000);
    // Refunds are surfaced as counts, never netted out of a figure the
    // schema has no refund amount for.
    expect(report.refundedOrderCount).toBe(1);
    expect(report.partiallyRefundedOrderCount).toBe(1);
  });

  it('ignores an order outside the window on either side', async () => {
    await seedPaidOrder({ placedAt: daysAgo(30), totalMinor: 80_000 });
    await seedPaidOrder({ placedAt: new Date(NOW.getTime() + DAY), totalMinor: 90_000 });
    await seedPaidOrder({ placedAt: daysAgo(3), totalMinor: 5_000 });

    const report = await getSalesReport(RANGE);
    expect(report.totals.paidRevenueMinor).toBe(5_000);
  });

  it('sums units from the items of paid orders only', async () => {
    await seedPaidOrder({ placedAt: daysAgo(1), totalMinor: 10_000, items: [{ quantity: 3 }] });
    await seedOrder({
      placedAt: daysAgo(1),
      totalMinor: 10_000,
      paymentStatus: 'UNPAID',
      items: [{ quantity: 7 }],
    });

    expect((await getSalesReport(RANGE)).totals.unitsSold).toBe(3);
  });

  it('counts customers who registered inside the window', async () => {
    await seedCustomer({ createdAt: daysAgo(2) });
    await seedCustomer({ createdAt: daysAgo(40) });

    expect((await getSalesReport(RANGE)).totals.newCustomerCount).toBe(1);
  });
});

describe('lastNDaysRange', () => {
  it('spans whole UTC days and includes today', () => {
    const range = lastNDaysRange(7, NOW);
    expect(range.from.toISOString()).toBe('2026-06-09T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-06-16T00:00:00.000Z');
  });

  it('produces exactly one daily bucket per day asked for', async () => {
    for (const days of [7, 30, 90]) {
      const report = await getSalesReport(lastNDaysRange(days, NOW));
      expect(report.revenueByDay).toHaveLength(days);
    }
  });
});

describe('the comparison window', () => {
  it('is the same length, immediately before the range', () => {
    const previous = previousRange(RANGE);
    expect(previous.to).toEqual(RANGE.from);
    expect(previous.to.getTime() - previous.from.getTime()).toBe(
      RANGE.to.getTime() - RANGE.from.getTime(),
    );
  });

  it('carries the previous period’s own totals, not the current one’s', async () => {
    await seedPaidOrder({ placedAt: daysAgo(2), totalMinor: 20_000 });
    await seedPaidOrder({ placedAt: daysAgo(9), totalMinor: 5_000 });

    const report = await getSalesReport(RANGE);
    expect(report.totals.paidRevenueMinor).toBe(20_000);
    expect(report.previous.paidRevenueMinor).toBe(5_000);
  });
});

describe('revenueByDay', () => {
  it('emits one bucket per whole day in the range, including the quiet ones', async () => {
    await seedPaidOrder({ placedAt: daysAgo(2), totalMinor: 10_000 });

    const report = await getSalesReport(RANGE);

    expect(report.revenueByDay).toHaveLength(7);
    expect(report.revenueByDay.filter((day) => day.revenueMinor > 0)).toHaveLength(1);
    expect(report.revenueByDay.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date))).toBe(true);
  });

  it('adds up two orders landing on the same day', async () => {
    await seedPaidOrder({ placedAt: new Date('2026-06-13T01:00:00.000Z'), totalMinor: 4_000 });
    await seedPaidOrder({ placedAt: new Date('2026-06-13T23:00:00.000Z'), totalMinor: 6_000 });

    const report = await getSalesReport(RANGE);
    const day = report.revenueByDay.find((entry) => entry.date === '2026-06-13');

    expect(day).toMatchObject({ revenueMinor: 10_000, orderCount: 2 });
  });

  it('never counts an unpaid order into the chart', async () => {
    await seedOrder({ placedAt: daysAgo(2), totalMinor: 90_000, paymentStatus: 'PENDING' });

    const report = await getSalesReport(RANGE);
    expect(report.revenueByDay.every((day) => day.revenueMinor === 0)).toBe(true);
  });
});

describe('topProducts', () => {
  it('ranks by revenue and sums a product’s variants into one row', async () => {
    const productId = '22222222-2222-4222-8222-222222222222';
    const other = '33333333-3333-4333-8333-333333333333';

    await seedPaidOrder({
      placedAt: daysAgo(1),
      totalMinor: 30_000,
      items: [
        { productId, quantity: 1, lineTotalMinor: 10_000, nameEn: 'Sedan' },
        { productId, quantity: 2, lineTotalMinor: 20_000, nameEn: 'Sedan' },
      ],
    });
    await seedPaidOrder({
      placedAt: daysAgo(1),
      totalMinor: 5_000,
      items: [{ productId: other, quantity: 1, lineTotalMinor: 5_000, nameEn: 'Coupe' }],
    });

    const report = await getSalesReport(RANGE);

    expect(report.topProducts).toHaveLength(2);
    expect(report.topProducts[0]).toMatchObject({
      productId,
      nameEn: 'Sedan',
      unitsSold: 3,
      revenueMinor: 30_000,
    });
    expect(report.topProducts[1]).toMatchObject({ productId: other, revenueMinor: 5_000 });
  });

  it('still names a product whose row was deleted, from the order’s own snapshot', async () => {
    await seedPaidOrder({
      placedAt: daysAgo(1),
      totalMinor: 8_000,
      items: [
        { productId: null, quantity: 1, lineTotalMinor: 8_000, nameEn: 'Gone', nameAr: 'محذوف' },
      ],
    });

    const report = await getSalesReport(RANGE);
    expect(report.topProducts[0]).toMatchObject({
      productId: null,
      nameEn: 'Gone',
      nameAr: 'محذوف',
    });
  });
});

describe('ordersByStatus', () => {
  it('counts every placed order, paid or not, biggest slice first', async () => {
    await seedOrder({ placedAt: daysAgo(1), totalMinor: 1_000, status: 'PENDING_PAYMENT' });
    await seedOrder({ placedAt: daysAgo(1), totalMinor: 1_000, status: 'PENDING_PAYMENT' });
    await seedPaidOrder({ placedAt: daysAgo(1), totalMinor: 1_000, status: 'COMPLETED' });

    const report = await getSalesReport(RANGE);

    expect(report.ordersByStatus[0]).toEqual({ status: 'PENDING_PAYMENT', count: 2 });
    expect(report.ordersByStatus).toContainEqual({ status: 'COMPLETED', count: 1 });
  });
});

describe('coupons', () => {
  it('groups paid orders by the code as typed, summing the discount', async () => {
    await seedPaidOrder({
      placedAt: daysAgo(1),
      totalMinor: 9_000,
      couponCode: 'SUMMER',
      discountMinor: 1_000,
    });
    await seedPaidOrder({
      placedAt: daysAgo(2),
      totalMinor: 8_000,
      couponCode: 'SUMMER',
      discountMinor: 2_000,
    });
    await seedPaidOrder({ placedAt: daysAgo(2), totalMinor: 5_000 });

    const report = await getSalesReport(RANGE);

    expect(report.coupons).toEqual([{ code: 'SUMMER', redemptions: 2, discountMinor: 3_000 }]);
  });

  it('does not credit a coupon on an order that was never paid', async () => {
    await seedOrder({
      placedAt: daysAgo(1),
      totalMinor: 9_000,
      paymentStatus: 'UNPAID',
      couponCode: 'GHOST',
      discountMinor: 1_000,
    });

    expect((await getSalesReport(RANGE)).coupons).toEqual([]);
  });
});

describe('percentageChange', () => {
  it('is null when there is nothing to compare against', () => {
    expect(percentageChange(500, 0)).toBeNull();
  });

  it('computes a rise and a fall', () => {
    expect(percentageChange(150, 100)).toBe(50);
    expect(percentageChange(50, 100)).toBe(-50);
  });
});

describe('the schema tables nothing writes', () => {
  it('confirms ProductView and DailyProductStats are still empty, so no views metric is built', async () => {
    // If this ever fails, something started recording views and a real
    // views panel becomes buildable — which is the only honest trigger for
    // adding one.
    expect(await db.productView.count()).toBe(0);
    expect(await db.dailyProductStats.count()).toBe(0);
  });
});
