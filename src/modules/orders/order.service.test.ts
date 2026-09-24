import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { db, AppError } from '@/modules/core';
import { createCategory } from '@/modules/catalog/category.service';
import { createProduct, publishProduct } from '@/modules/catalog/product.service';
import { resetCatalogTables } from '@/modules/catalog/testing';
import { adjustStock } from '@/modules/inventory';
import { createCoupon } from '@/modules/pricing/coupon.service';
import { resetPricingTables } from '@/modules/pricing/testing';
import { addItem, getOrCreateCart, newGuestToken, setCartCoupon } from '@/modules/cart';
import { resetCartTables } from '@/modules/cart/testing';

import { cancelOrder, placeOrder, transitionOrderStatus } from './order.service';
import { getOrderForCustomer, listCustomerOrders } from './order-queries';
import { resetOrderTables } from './testing';

/**
 * The order lifecycle against a real database.
 *
 * These are the tests that matter: an order is money and stock, and the only
 * way to know the transaction boundary holds is to make it fail halfway and
 * check that nothing survived.
 */

beforeEach(async () => {
  await resetOrderTables();
  await resetCartTables();
  await resetPricingTables();
  await resetCatalogTables();
  await db.customer.deleteMany();
  await db.user.deleteMany();
});

async function shoes(options: { priceMinor?: number; stockQuantity?: number } = {}) {
  const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
  const product = await createProduct({
    product: {
      slug: 'running-shoes',
      nameAr: 'حذاء الجري',
      nameEn: 'Running Shoes',
      categoryId: category.id,
    },
    variants: [
      {
        sku: 'RUN-BLK-41',
        labelAr: 'أسود / 41',
        labelEn: 'Black / 41',
        priceMinor: options.priceMinor ?? 45_000,
        stockQuantity: options.stockQuantity ?? 5,
      },
    ],
  });
  await publishProduct(product.id);
  return { category, product, variant: product.variants[0]! };
}

async function guestOwner() {
  const guestToken = newGuestToken();
  await getOrCreateCart({ customerId: null, guestToken });
  return { customerId: null, guestToken };
}

async function customerOwner(email = 'shopper@example.com') {
  const user = await db.user.create({ data: { email, passwordHash: 'x', role: 'CUSTOMER' } });
  const customer = await db.customer.create({ data: { userId: user.id } });
  return { customerId: customer.id, guestToken: null };
}

function checkoutInput(overrides: { idempotencyKey?: string } = {}) {
  return {
    contact: { email: 'shopper@example.com', phone: '0512345678' },
    shippingAddress: {
      fullName: 'أحمد يوسف',
      phone: '0512345678',
      city: 'الرياض',
      district: 'العليا',
      street: 'طريق الملك فهد',
      buildingNumber: '3210',
      postalCode: '12211',
      country: 'SA' as const,
    },
    idempotencyKey: overrides.idempotencyKey ?? randomUUID(),
  };
}

async function stockOf(variantId: string): Promise<number> {
  const variant = await db.variant.findUniqueOrThrow({ where: { id: variantId } });
  return variant.stockQuantity;
}

describe('placeOrder', () => {
  it('turns a cart into an order with server-calculated totals', async () => {
    const { variant, product } = await shoes({ priceMinor: 45_000, stockQuantity: 5 });
    const owner = await guestOwner();
    await addItem(owner, { variantId: variant.id, quantity: 2 });

    const { order, accessToken } = await placeOrder({ owner, input: checkoutInput() });

    expect(order.number).toMatch(/^LD-\d{6}-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.paymentStatus).toBe('UNPAID');
    expect(order.fulfillmentStatus).toBe('UNFULFILLED');
    expect(order.subtotalMinor).toBe(90_000);
    expect(order.discountMinor).toBe(0);
    expect(order.totalMinor).toBe(90_000);
    expect(order.currency).toBe('SAR');
    // Not faked, not calculated: no engine exists yet (§21).
    expect(order.shippingMinor).toBe(0);
    expect(order.taxMinor).toBe(0);
    // A guest gets a credential; a signed-in customer does not need one.
    expect(accessToken).toBeTruthy();
    expect(order.accessTokenHash).not.toBe(accessToken);

    const items = await db.orderItem.findMany({ where: { orderId: order.id } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      productNameArSnapshot: 'حذاء الجري',
      productNameEnSnapshot: 'Running Shoes',
      variantLabelEnSnapshot: 'Black / 41',
      skuSnapshot: 'RUN-BLK-41',
      unitPriceMinor: 45_000,
      quantity: 2,
      lineSubtotalMinor: 90_000,
      lineTotalMinor: 90_000,
      productId: product.id,
    });
  });

  it('keeps the snapshot readable after the product is renamed and deleted', async () => {
    const { variant, product } = await shoes();
    const owner = await guestOwner();
    await addItem(owner, { variantId: variant.id, quantity: 1 });
    const { order } = await placeOrder({ owner, input: checkoutInput() });

    await db.product.update({
      where: { id: product.id },
      data: { nameAr: 'اسم مختلف', nameEn: 'Renamed', deletedAt: new Date() },
    });

    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item.productNameEnSnapshot).toBe('Running Shoes');
    expect(item.unitPriceMinor).toBe(45_000);
  });

  it('decrements stock through the inventory domain, with an auditable reason', async () => {
    const { variant } = await shoes({ stockQuantity: 5 });
    const owner = await guestOwner();
    await addItem(owner, { variantId: variant.id, quantity: 2 });

    const { order } = await placeOrder({ owner, input: checkoutInput() });

    expect(await stockOf(variant.id)).toBe(3);
    const adjustments = await db.inventoryAdjustment.findMany({ where: { orderId: order.id } });
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({
      delta: -2,
      previousQuantity: 5,
      newQuantity: 3,
      reason: 'SALE',
    });
  });

  it('empties the cart, because everything in it became the order', async () => {
    const { variant } = await shoes();
    const owner = await guestOwner();
    await addItem(owner, { variantId: variant.id, quantity: 1 });

    await placeOrder({ owner, input: checkoutInput() });

    const remaining = await db.cartItem.count();
    expect(remaining).toBe(0);
  });

  it('finalises the coupon and attaches the redemption to the order', async () => {
    const { variant } = await shoes({ priceMinor: 100_000 });
    const coupon = await createCoupon({
      code: 'SAVE10',
      type: 'PERCENTAGE',
      value: 10,
      active: true,
    });
    const owner = await customerOwner();
    await addItem(owner, { variantId: variant.id, quantity: 1 });
    await setCartCoupon(owner, 'SAVE10');

    const { order } = await placeOrder({ owner, input: checkoutInput() });

    expect(order.discountMinor).toBe(10_000);
    expect(order.totalMinor).toBe(90_000);
    expect(order.couponCode).toBe('SAVE10');

    const redemptions = await db.couponRedemption.findMany({ where: { couponId: coupon.id } });
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0]!.orderId).toBe(order.id);
    expect(redemptions[0]!.customerId).toBe(owner.customerId);

    const after = await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
    expect(after.usedCount).toBe(1);
  });

  it('refuses an empty cart', async () => {
    const owner = await guestOwner();
    await expect(placeOrder({ owner, input: checkoutInput() })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('refuses when stock ran out after the cart was filled, and takes nothing', async () => {
    const { variant } = await shoes({ stockQuantity: 2 });
    const owner = await guestOwner();
    await addItem(owner, { variantId: variant.id, quantity: 2 });
    // Someone else bought them in the meantime.
    await adjustStock({ variantId: variant.id, setTo: 0, reason: 'CORRECTION' });

    await expect(placeOrder({ owner, input: checkoutInput() })).rejects.toBeInstanceOf(AppError);

    expect(await db.order.count()).toBe(0);
    expect(await stockOf(variant.id)).toBe(0);
  });

  it('leaves no order, no stock movement and no redemption when the transaction fails', async () => {
    const { variant } = await shoes({ stockQuantity: 1 });
    const coupon = await createCoupon({
      code: 'HALF',
      type: 'PERCENTAGE',
      value: 50,
      active: true,
    });
    const owner = await customerOwner();
    await addItem(owner, { variantId: variant.id, quantity: 1 });
    await setCartCoupon(owner, 'HALF');

    // Stock disappears between the cart view and the transaction.
    await adjustStock({ variantId: variant.id, setTo: 0, reason: 'DAMAGED' });

    await expect(placeOrder({ owner, input: checkoutInput() })).rejects.toBeInstanceOf(AppError);

    expect(await db.order.count()).toBe(0);
    expect(await db.orderItem.count()).toBe(0);
    expect(await db.couponRedemption.count()).toBe(0);
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(0);
    // The cart survives a failed checkout — losing it would be worse than
    // the failure itself.
    expect(await db.cartItem.count()).toBe(1);
  });

  it('records the creation event, the audit entry and the outbox notifications', async () => {
    const { variant } = await shoes();
    const owner = await guestOwner();
    await addItem(owner, { variantId: variant.id, quantity: 1 });

    const { order } = await placeOrder({ owner, input: checkoutInput() });

    const events = await db.orderEvent.findMany({ where: { orderId: order.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'CREATED', toValue: 'PENDING_PAYMENT' });

    const audit = await db.auditLog.findMany({ where: { entityId: order.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe('order.created');

    const outbox = await db.outboxEvent.findMany();
    expect(outbox.map((event) => event.type).sort()).toEqual([
      'order.created',
      'order.payment_required',
    ]);
    // Recorded for P13, never delivered here.
    expect(outbox.every((event) => event.status === 'PENDING')).toBe(true);
  });

  it('normalises the phone and stores the address as structured fields', async () => {
    const { variant } = await shoes();
    const owner = await guestOwner();
    await addItem(owner, { variantId: variant.id, quantity: 1 });

    const { order } = await placeOrder({ owner, input: checkoutInput() });

    expect(order.customerPhone).toBe('+966512345678');
    expect(order.shippingAddress).toMatchObject({
      city: 'الرياض',
      district: 'العليا',
      buildingNumber: '3210',
      country: 'SA',
    });
  });
});

describe('idempotency', () => {
  it('returns the same order for a repeated submission and takes stock once', async () => {
    const { variant } = await shoes({ stockQuantity: 5 });
    const owner = await guestOwner();
    await addItem(owner, { variantId: variant.id, quantity: 1 });
    const input = checkoutInput();

    const first = await placeOrder({ owner, input });
    const second = await placeOrder({ owner, input });

    expect(second.order.id).toBe(first.order.id);
    expect(second.deduplicated).toBe(true);
    expect(await db.order.count()).toBe(1);
    expect(await stockOf(variant.id)).toBe(4);
  });

  it('does not let one owner claim another owner’s order through the key', async () => {
    const { variant } = await shoes({ stockQuantity: 5 });
    const alice = await customerOwner('alice@example.com');
    await addItem(alice, { variantId: variant.id, quantity: 1 });
    const input = checkoutInput();
    await placeOrder({ owner: alice, input });

    const bob = await customerOwner('bob@example.com');
    await addItem(bob, { variantId: variant.id, quantity: 1 });

    await expect(placeOrder({ owner: bob, input })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await db.order.count()).toBe(1);
  });

  it('lets a genuinely new submission through after a failure', async () => {
    const { variant } = await shoes({ stockQuantity: 0 });
    const owner = await guestOwner();
    await db.variant.update({ where: { id: variant.id }, data: { stockQuantity: 1 } });
    await addItem(owner, { variantId: variant.id, quantity: 1 });
    await db.variant.update({ where: { id: variant.id }, data: { stockQuantity: 0 } });

    const input = checkoutInput();
    await expect(placeOrder({ owner, input })).rejects.toBeInstanceOf(AppError);

    // The failed attempt must not have burned its key: the rollback removed
    // the row that would have held it.
    await db.variant.update({ where: { id: variant.id }, data: { stockQuantity: 3 } });
    const retry = await placeOrder({ owner, input });
    expect(retry.deduplicated).toBe(false);
    expect(await db.order.count()).toBe(1);
  });
});

describe('transitions', () => {
  async function placedOrder() {
    const { variant } = await shoes({ stockQuantity: 5 });
    const owner = await customerOwner();
    await addItem(owner, { variantId: variant.id, quantity: 1 });
    const { order } = await placeOrder({ owner, input: checkoutInput() });
    return { order, owner, variant };
  }

  it('walks the allowed path and records who moved it', async () => {
    const { order } = await placedOrder();
    const staff = await db.user.create({
      data: { email: 'staff@example.com', passwordHash: 'x', role: 'STAFF' },
    });

    const confirmed = await transitionOrderStatus(order.id, 'CONFIRMED', {
      actorUserId: staff.id,
    });
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.confirmedAt).toBeInstanceOf(Date);

    const events = await db.orderEvent.findMany({
      where: { orderId: order.id, type: 'ORDER_STATUS' },
    });
    expect(events[0]).toMatchObject({
      fromValue: 'PENDING_PAYMENT',
      toValue: 'CONFIRMED',
      actorUserId: staff.id,
    });
  });

  it('refuses an impossible jump', async () => {
    const { order } = await placedOrder();
    await expect(transitionOrderStatus(order.id, 'COMPLETED')).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
    const unchanged = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.status).toBe('PENDING_PAYMENT');
  });

  it('refuses to move a cancelled order at all', async () => {
    const { order } = await placedOrder();
    await cancelOrder(order.id);
    await expect(transitionOrderStatus(order.id, 'CONFIRMED')).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
  });
});

describe('cancellation', () => {
  async function placedOrder(quantity = 2) {
    const { variant } = await shoes({ stockQuantity: 5 });
    const owner = await customerOwner();
    await addItem(owner, { variantId: variant.id, quantity });
    const { order } = await placeOrder({ owner, input: checkoutInput() });
    return { order, owner, variant };
  }

  it('cancels and gives the stock back', async () => {
    const { order, variant } = await placedOrder(2);
    expect(await stockOf(variant.id)).toBe(3);

    const result = await cancelOrder(order.id, { reason: 'customer changed their mind' });

    expect(result.cancelled).toBe(true);
    expect(result.restoredQuantity).toBe(2);
    expect(result.order.status).toBe('CANCELLED');
    expect(result.order.fulfillmentStatus).toBe('CANCELLED');
    expect(result.order.cancellationReason).toBe('customer changed their mind');
    expect(await stockOf(variant.id)).toBe(5);

    const restore = await db.inventoryAdjustment.findFirstOrThrow({
      where: { orderId: order.id, reason: 'CANCELLATION' },
    });
    expect(restore.delta).toBe(2);
  });

  it('does not restore stock twice when cancellation is repeated', async () => {
    const { order, variant } = await placedOrder(2);
    await cancelOrder(order.id);
    expect(await stockOf(variant.id)).toBe(5);

    const second = await cancelOrder(order.id);

    expect(second.cancelled).toBe(false);
    expect(second.restoredQuantity).toBe(0);
    expect(await stockOf(variant.id)).toBe(5);
    const restores = await db.inventoryAdjustment.findMany({
      where: { orderId: order.id, reason: 'CANCELLATION' },
    });
    expect(restores).toHaveLength(1);
  });

  it('leaves the payment status alone — cancelling is not refunding', async () => {
    const { order } = await placedOrder();
    const result = await cancelOrder(order.id);
    expect(result.order.paymentStatus).toBe('UNPAID');
  });

  it('refuses to cancel a completed order', async () => {
    const { order } = await placedOrder();
    await transitionOrderStatus(order.id, 'CONFIRMED');
    await transitionOrderStatus(order.id, 'PROCESSING');
    await transitionOrderStatus(order.id, 'COMPLETED');

    await expect(cancelOrder(order.id)).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
  });
});

describe('customer order history', () => {
  it('lists only that customer’s orders, newest first', async () => {
    const { variant } = await shoes({ stockQuantity: 10 });
    const alice = await customerOwner('alice@example.com');
    const bob = await customerOwner('bob@example.com');

    await addItem(alice, { variantId: variant.id, quantity: 1 });
    const first = await placeOrder({ owner: alice, input: checkoutInput() });
    await addItem(alice, { variantId: variant.id, quantity: 2 });
    const second = await placeOrder({ owner: alice, input: checkoutInput() });
    await addItem(bob, { variantId: variant.id, quantity: 1 });
    await placeOrder({ owner: bob, input: checkoutInput() });

    const page = await listCustomerOrders(alice.customerId!);

    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.number)).toEqual([
      second.order.number,
      first.order.number,
    ]);
    expect(page.items[0]!.itemCount).toBe(2);
  });

  it('returns null for another customer’s order number', async () => {
    const { variant } = await shoes({ stockQuantity: 10 });
    const alice = await customerOwner('alice@example.com');
    const bob = await customerOwner('bob@example.com');
    await addItem(alice, { variantId: variant.id, quantity: 1 });
    const { order } = await placeOrder({ owner: alice, input: checkoutInput() });

    expect(await getOrderForCustomer(order.number, bob.customerId!)).toBeNull();
    expect(await getOrderForCustomer(order.number, alice.customerId!)).not.toBeNull();
  });
});
