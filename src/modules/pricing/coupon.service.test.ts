import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';
import { createCategory } from '@/modules/catalog/category.service';
import { createProduct, publishProduct } from '@/modules/catalog/product.service';
import { resetCatalogTables } from '@/modules/catalog/testing';

import {
  consumeCouponUsage,
  countRedemptions,
  createCoupon,
  deleteCoupon,
  evaluateCouponForCart,
  getCouponByCode,
  listCoupons,
  setCouponActive,
  updateCoupon,
} from './coupon.service';
import { resetPricingTables } from './testing';
import type { PricingLineInput } from './cart-pricing';

beforeEach(async () => {
  await resetPricingTables();
  await db.order.deleteMany();
  await resetCatalogTables();
  await db.customer.deleteMany();
  await db.user.deleteMany();
});

async function customer(email = 'shopper@example.com') {
  const user = await db.user.create({ data: { email, passwordHash: 'x', role: 'CUSTOMER' } });
  return db.customer.create({ data: { userId: user.id } });
}

/** A minimal order, only as an anchor for a redemption row — the schema
 * requires one, which is exactly the boundary P09 must not cross. */
async function order(number: string, customerId: string | null) {
  return db.order.create({
    data: {
      number,
      customerId,
      status: 'PENDING_PAYMENT',
      subtotalMinor: 10_000,
      totalMinor: 10_000,
    },
  });
}

function line(overrides: Partial<PricingLineInput> = {}): PricingLineInput {
  return {
    variantId: 'v1',
    productId: 'p1',
    categoryId: 'c1',
    brandId: null,
    quantity: 1,
    unitPriceMinor: 50_000,
    ...overrides,
  };
}

describe('code normalisation', () => {
  it('stores a canonical code and finds it however it is typed', async () => {
    await createCoupon({ code: '  welcome10 ', type: 'PERCENTAGE', value: 10 });

    expect((await getCouponByCode('WELCOME10'))?.code).toBe('WELCOME10');
    expect((await getCouponByCode('welcome10'))?.code).toBe('WELCOME10');
    expect((await getCouponByCode(' WeLcOmE10 '))?.code).toBe('WELCOME10');
  });

  it('refuses a duplicate code, whatever case it arrives in', async () => {
    await createCoupon({ code: 'SUMMER', type: 'FIXED', value: 5_000 });
    await expect(
      createCoupon({ code: 'summer', type: 'FIXED', value: 1_000 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects codes with characters that would not survive a URL or a phone call', async () => {
    for (const code of ['a b!', 'hé', '--', 'ab']) {
      await expect(createCoupon({ code, type: 'FIXED', value: 100 })).rejects.toThrow();
    }
  });
});

describe('server-side validation', () => {
  it('rejects a percentage above 100', async () => {
    await expect(
      createCoupon({ code: 'TOOMUCH', type: 'PERCENTAGE', value: 101 }),
    ).rejects.toThrow();
  });

  it('rejects a zero or negative value', async () => {
    await expect(createCoupon({ code: 'ZERO', type: 'FIXED', value: 0 })).rejects.toThrow();
    await expect(createCoupon({ code: 'NEG', type: 'PERCENTAGE', value: -5 })).rejects.toThrow();
  });

  it('rejects a window that ends before it starts', async () => {
    await expect(
      createCoupon({
        code: 'BACKWARDS',
        type: 'FIXED',
        value: 100,
        startsAt: new Date('2026-07-01'),
        endsAt: new Date('2026-06-01'),
      }),
    ).rejects.toThrow();
  });

  it('rejects a maximum discount on a fixed-amount promotion', async () => {
    await expect(
      createCoupon({ code: 'ODD', type: 'FIXED', value: 500, maxDiscountMinor: 100 }),
    ).rejects.toThrow();
  });
});

describe('evaluateCouponForCart', () => {
  it('reports an unknown code without saying whether one exists', async () => {
    const { coupon, evaluation } = await evaluateCouponForCart({
      code: 'NOPE',
      lines: [line()],
      customerId: null,
    });
    expect(coupon).toBeNull();
    expect(evaluation).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('accepts a live code', async () => {
    await createCoupon({ code: 'LIVE', type: 'PERCENTAGE', value: 10 });
    const { evaluation } = await evaluateCouponForCart({
      code: 'live',
      lines: [line()],
      customerId: null,
    });
    expect(evaluation.ok).toBe(true);
  });

  it('counts a customer own redemptions against a per-customer limit', async () => {
    const shopper = await customer();
    const coupon = await createCoupon({
      code: 'ONCE',
      type: 'FIXED',
      value: 1_000,
      perCustomerLimit: 1,
    });
    await consumeCouponUsage({
      couponId: coupon.id,
      customerId: shopper.id,
      orderId: (await order('ORD-1', shopper.id)).id,
    });

    const mine = await evaluateCouponForCart({
      code: 'ONCE',
      lines: [line()],
      customerId: shopper.id,
    });
    expect(mine.evaluation).toMatchObject({ ok: false, reason: 'customer_limit_reached' });

    // Somebody else is unaffected by my history.
    const other = await customer('other@example.com');
    const theirs = await evaluateCouponForCart({
      code: 'ONCE',
      lines: [line()],
      customerId: other.id,
    });
    expect(theirs.evaluation.ok).toBe(true);
  });

  it('evaluating never consumes anything', async () => {
    const coupon = await createCoupon({ code: 'FREE', type: 'FIXED', value: 100, usageLimit: 1 });

    for (let i = 0; i < 5; i += 1) {
      const { evaluation } = await evaluateCouponForCart({
        code: 'FREE',
        lines: [line()],
        customerId: null,
      });
      expect(evaluation.ok).toBe(true);
    }
    expect(await countRedemptions(coupon.id, null)).toBe(0);
    expect((await getCouponByCode('FREE'))?.usedCount).toBe(0);
  });
});

describe('consumeCouponUsage — the P10 boundary', () => {
  it('records a redemption and moves the counter', async () => {
    const shopper = await customer();
    const coupon = await createCoupon({ code: 'USE', type: 'FIXED', value: 500 });
    const placed = await order('ORD-10', shopper.id);

    const result = await consumeCouponUsage({
      couponId: coupon.id,
      customerId: shopper.id,
      orderId: placed.id,
    });

    expect(result.usedCount).toBe(1);
    expect(await countRedemptions(coupon.id, shopper.id)).toBe(1);
  });

  it('two checkouts racing for the last slot: exactly one wins', async () => {
    const a = await customer('a@example.com');
    const b = await customer('b@example.com');
    const coupon = await createCoupon({
      code: 'LASTONE',
      type: 'FIXED',
      value: 500,
      usageLimit: 1,
    });
    const orderA = await order('ORD-A', a.id);
    const orderB = await order('ORD-B', b.id);

    // Issued together so they genuinely overlap. Without the row lock both
    // read a used count of 0 and both succeed — one free discount the store
    // never agreed to give.
    const results = await Promise.allSettled([
      consumeCouponUsage({ couponId: coupon.id, customerId: a.id, orderId: orderA.id }),
      consumeCouponUsage({ couponId: coupon.id, customerId: b.id, orderId: orderB.id }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await countRedemptions(coupon.id, null)).toBe(1);
    expect((await getCouponByCode('LASTONE'))?.usedCount).toBe(1);
  });

  it('refuses once the global limit is spent', async () => {
    const shopper = await customer();
    const coupon = await createCoupon({ code: 'ONE', type: 'FIXED', value: 500, usageLimit: 1 });
    await consumeCouponUsage({
      couponId: coupon.id,
      customerId: shopper.id,
      orderId: (await order('ORD-X', shopper.id)).id,
    });

    await expect(
      consumeCouponUsage({
        couponId: coupon.id,
        customerId: shopper.id,
        orderId: (await order('ORD-Y', shopper.id)).id,
      }),
    ).rejects.toMatchObject({ code: 'COUPON_LIMIT_REACHED' });
  });

  it('refuses an inactive promotion', async () => {
    const shopper = await customer();
    const coupon = await createCoupon({ code: 'OFF', type: 'FIXED', value: 500, active: false });
    await expect(
      consumeCouponUsage({
        couponId: coupon.id,
        customerId: shopper.id,
        orderId: (await order('ORD-Z', shopper.id)).id,
      }),
    ).rejects.toMatchObject({ code: 'COUPON_INVALID' });
  });
});

describe('admin management', () => {
  it('rewrites scopes wholesale on update', async () => {
    const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
    const product = await createProduct({
      product: { slug: 'runner', nameAr: 'حذاء', nameEn: 'Runner', categoryId: category.id },
      variants: [{ sku: 'RUN-1', priceMinor: 1_000 }],
    });
    await publishProduct(product.id);

    const coupon = await createCoupon({
      code: 'SCOPED',
      type: 'PERCENTAGE',
      value: 10,
      scopes: [{ scopeType: 'CATEGORY', targetId: category.id }],
    });
    expect(coupon.scopes).toHaveLength(1);

    const updated = await updateCoupon(coupon.id, {
      code: 'SCOPED',
      type: 'PERCENTAGE',
      value: 10,
      scopes: [{ scopeType: 'PRODUCT', targetId: product.id }],
    });

    expect(updated.scopes).toHaveLength(1);
    expect(updated.scopes[0]!.scopeType).toBe('PRODUCT');
  });

  it('refuses a stale update from a second editor', async () => {
    const coupon = await createCoupon({ code: 'RACE', type: 'FIXED', value: 100 });
    const loadedAt = coupon.updatedAt;

    await updateCoupon(coupon.id, { code: 'RACE', type: 'FIXED', value: 200 }, loadedAt);
    await expect(
      updateCoupon(coupon.id, { code: 'RACE', type: 'FIXED', value: 300 }, loadedAt),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect((await getCouponByCode('RACE'))?.value).toBe(200);
  });

  it('activates and deactivates', async () => {
    const coupon = await createCoupon({ code: 'TOGGLE', type: 'FIXED', value: 100 });
    expect((await setCouponActive(coupon.id, false)).active).toBe(false);
    expect((await setCouponActive(coupon.id, true)).active).toBe(true);
  });

  it('deletes an unused promotion but refuses one that was redeemed', async () => {
    const unused = await createCoupon({ code: 'UNUSED', type: 'FIXED', value: 100 });
    await deleteCoupon(unused.id);
    expect(await getCouponByCode('UNUSED')).toBeNull();

    const shopper = await customer();
    const used = await createCoupon({ code: 'USED', type: 'FIXED', value: 100 });
    await consumeCouponUsage({
      couponId: used.id,
      customerId: shopper.id,
      orderId: (await order('ORD-D', shopper.id)).id,
    });

    await expect(deleteCoupon(used.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('listCoupons', () => {
  const NOW = new Date('2026-06-15T00:00:00.000Z');

  beforeEach(async () => {
    await createCoupon({ code: 'LIVE', type: 'PERCENTAGE', value: 10 });
    await createCoupon({ code: 'OFF', type: 'FIXED', value: 500, active: false });
    await createCoupon({
      code: 'LATER',
      type: 'FIXED',
      value: 500,
      startsAt: new Date('2026-08-01'),
    });
    await createCoupon({
      code: 'GONE',
      type: 'FIXED',
      value: 500,
      endsAt: new Date('2026-01-01'),
    });
  });

  it('filters by status in the database', async () => {
    expect((await listCoupons({ status: 'active' }, NOW)).items.map((c) => c.code)).toEqual([
      'LIVE',
    ]);
    expect((await listCoupons({ status: 'inactive' }, NOW)).items.map((c) => c.code)).toEqual([
      'OFF',
    ]);
    expect((await listCoupons({ status: 'scheduled' }, NOW)).items.map((c) => c.code)).toEqual([
      'LATER',
    ]);
    expect((await listCoupons({ status: 'expired' }, NOW)).items.map((c) => c.code)).toEqual([
      'GONE',
    ]);
  });

  it('filters by type and searches by code', async () => {
    expect((await listCoupons({ type: 'PERCENTAGE' }, NOW)).total).toBe(1);
    expect((await listCoupons({ q: 'liv' }, NOW)).items.map((c) => c.code)).toEqual(['LIVE']);
  });

  it('pages in the database with a stable order', async () => {
    const first = await listCoupons({ sort: 'code-asc', pageSize: 2, page: 1 }, NOW);
    const second = await listCoupons({ sort: 'code-asc', pageSize: 2, page: 2 }, NOW);

    expect(first.items.map((c) => c.code)).toEqual(['GONE', 'LATER']);
    expect(second.items.map((c) => c.code)).toEqual(['LIVE', 'OFF']);
    expect(first.total).toBe(4);
    expect(first.pageCount).toBe(2);
  });

  it('caps the page size rather than letting a URL ask for everything', async () => {
    expect((await listCoupons({ pageSize: 100_000 }, NOW)).pageSize).toBe(100);
  });
});
