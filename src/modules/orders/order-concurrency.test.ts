import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';
import { createCategory } from '@/modules/catalog/category.service';
import { createProduct, publishProduct } from '@/modules/catalog/product.service';
import { resetCatalogTables } from '@/modules/catalog/testing';
import { createCoupon } from '@/modules/pricing/coupon.service';
import { resetPricingTables } from '@/modules/pricing/testing';
import { addItem, setCartCoupon } from '@/modules/cart';
import { resetCartTables } from '@/modules/cart/testing';

import { cancelOrder, placeOrder } from './order.service';
import { resetOrderTables } from './testing';

/**
 * Races (P10 §32).
 *
 * Every test here runs the operations genuinely in parallel and asserts on
 * the state afterwards. A test that awaits them in sequence proves nothing:
 * the bug being hunted only exists when two transactions overlap.
 */

beforeEach(async () => {
  await resetOrderTables();
  await resetCartTables();
  await resetPricingTables();
  await resetCatalogTables();
  await db.customer.deleteMany();
  await db.user.deleteMany();
});

async function shoes(stockQuantity: number, priceMinor = 45_000) {
  const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
  const product = await createProduct({
    product: {
      slug: 'running-shoes',
      nameAr: 'حذاء الجري',
      nameEn: 'Running Shoes',
      categoryId: category.id,
    },
    variants: [{ sku: 'RUN-BLK-41', priceMinor, stockQuantity }],
  });
  await publishProduct(product.id);
  return product.variants[0]!;
}

async function customerOwner(email: string) {
  const user = await db.user.create({ data: { email, passwordHash: 'x', role: 'CUSTOMER' } });
  const customer = await db.customer.create({ data: { userId: user.id } });
  return { customerId: customer.id, guestToken: null };
}

function checkoutInput(idempotencyKey = randomUUID()) {
  return {
    contact: { email: 'shopper@example.com', phone: '0512345678' },
    shippingAddress: {
      fullName: 'أحمد يوسف',
      phone: '0512345678',
      city: 'الرياض',
      district: 'العليا',
      street: 'طريق الملك فهد',
      buildingNumber: '3210',
      country: 'SA' as const,
    },
    idempotencyKey,
  };
}

describe('inventory race — the last unit', () => {
  it('sells it exactly once when two customers check out simultaneously', async () => {
    const variant = await shoes(1);
    const alice = await customerOwner('alice@example.com');
    const bob = await customerOwner('bob@example.com');
    await addItem(alice, { variantId: variant.id, quantity: 1 });
    await addItem(bob, { variantId: variant.id, quantity: 1 });

    const results = await Promise.allSettled([
      placeOrder({ owner: alice, input: checkoutInput() }),
      placeOrder({ owner: bob, input: checkoutInput() }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The loser fails cleanly, not with a database error leaking through.
    const reason = (rejected[0] as PromiseRejectedResult).reason as { code?: string };
    expect(reason.code).toBe('OUT_OF_STOCK');

    const after = await db.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(after.stockQuantity).toBe(0);
    expect(after.stockQuantity).toBeGreaterThanOrEqual(0);

    expect(await db.order.count()).toBe(1);
    // And exactly one movement was recorded for the one unit that sold.
    const sales = await db.inventoryAdjustment.findMany({ where: { reason: 'SALE' } });
    expect(sales).toHaveLength(1);
    expect(sales[0]!.delta).toBe(-1);
  });

  it('holds under five simultaneous attempts on two units', async () => {
    const variant = await shoes(2);
    const owners = await Promise.all(
      Array.from({ length: 5 }, (_, index) => customerOwner(`racer${index}@example.com`)),
    );
    for (const owner of owners) {
      await addItem(owner, { variantId: variant.id, quantity: 1 });
    }

    const results = await Promise.allSettled(
      owners.map((owner) => placeOrder({ owner, input: checkoutInput() })),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    const after = await db.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(after.stockQuantity).toBe(0);
    expect(await db.order.count()).toBe(2);
  });
});

describe('duplicate checkout race', () => {
  it('creates exactly one order when the same key is submitted twice at once', async () => {
    const variant = await shoes(10);
    const owner = await customerOwner('shopper@example.com');
    await addItem(owner, { variantId: variant.id, quantity: 1 });
    const input = checkoutInput();

    const results = await Promise.allSettled([
      placeOrder({ owner, input }),
      placeOrder({ owner, input }),
    ]);

    // Both calls succeed — the second recognises the first's order rather
    // than erroring at the customer, which is the point of idempotency.
    const orders = results
      .filter((result) => result.status === 'fulfilled')
      .map(
        (result) => (result as PromiseFulfilledResult<{ order: { id: string } }>).value.order.id,
      );

    expect(await db.order.count()).toBe(1);
    expect(new Set(orders).size).toBe(1);

    // One order means one unit sold, not two.
    const after = await db.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(after.stockQuantity).toBe(9);
  });
});

describe('coupon race', () => {
  it('cannot exceed a global usage limit of one', async () => {
    const variant = await shoes(10, 100_000);
    await createCoupon({
      code: 'ONLYONE',
      type: 'PERCENTAGE',
      value: 20,
      active: true,
      usageLimit: 1,
    });

    const alice = await customerOwner('alice@example.com');
    const bob = await customerOwner('bob@example.com');
    for (const owner of [alice, bob]) {
      await addItem(owner, { variantId: variant.id, quantity: 1 });
      await setCartCoupon(owner, 'ONLYONE');
    }

    const results = await Promise.allSettled([
      placeOrder({ owner: alice, input: checkoutInput() }),
      placeOrder({ owner: bob, input: checkoutInput() }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.couponRedemption.count()).toBe(1);
    expect(await db.order.count()).toBe(1);

    const coupon = await db.coupon.findUniqueOrThrow({ where: { code: 'ONLYONE' } });
    expect(coupon.usedCount).toBe(1);
  });

  it('cannot exceed a per-customer limit through simultaneous orders', async () => {
    const variant = await shoes(10, 100_000);
    await createCoupon({
      code: 'ONCEEACH',
      type: 'FIXED',
      value: 5_000,
      active: true,
      perCustomerLimit: 1,
    });

    const owner = await customerOwner('repeat@example.com');
    await addItem(owner, { variantId: variant.id, quantity: 2 });
    await setCartCoupon(owner, 'ONCEEACH');

    // Two different submissions (different keys) from the same customer.
    const results = await Promise.allSettled([
      placeOrder({ owner, input: checkoutInput() }),
      placeOrder({ owner, input: checkoutInput() }),
    ]);

    const succeeded = results.filter((result) => result.status === 'fulfilled').length;
    expect(succeeded).toBe(1);
    expect(await db.couponRedemption.count()).toBe(1);
  });
});

describe('cancellation race', () => {
  it('restores stock once when two cancellations arrive together', async () => {
    const variant = await shoes(5);
    const owner = await customerOwner('shopper@example.com');
    await addItem(owner, { variantId: variant.id, quantity: 3 });
    const { order } = await placeOrder({ owner, input: checkoutInput() });

    expect((await db.variant.findUniqueOrThrow({ where: { id: variant.id } })).stockQuantity).toBe(
      2,
    );

    const results = await Promise.allSettled([cancelOrder(order.id), cancelOrder(order.id)]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);

    const restored = results
      .filter((result) => result.status === 'fulfilled')
      .map(
        (result) =>
          (result as PromiseFulfilledResult<{ restoredQuantity: number }>).value.restoredQuantity,
      )
      .reduce((sum, quantity) => sum + quantity, 0);

    // Three units back, in total, across both calls — not six.
    expect(restored).toBe(3);
    expect((await db.variant.findUniqueOrThrow({ where: { id: variant.id } })).stockQuantity).toBe(
      5,
    );
    const restorations = await db.inventoryAdjustment.findMany({
      where: { orderId: order.id, reason: 'CANCELLATION' },
    });
    expect(restorations).toHaveLength(1);
  });
});
