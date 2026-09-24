import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';
import { createCategory } from '@/modules/catalog/category.service';
import { createProduct, publishProduct } from '@/modules/catalog/product.service';
import { resetCatalogTables } from '@/modules/catalog/testing';
import { createCoupon } from '@/modules/pricing/coupon.service';
import { resetPricingTables } from '@/modules/pricing/testing';
import { addItem, getOrCreateCart, newGuestToken, setCartCoupon } from '@/modules/cart';
import { resetCartTables } from '@/modules/cart/testing';
import { resetPaymentTables } from '@/modules/payments/testing';
import { stubPaymentProviderApi, verifiedEvent } from '@/modules/payments/test-fixtures';

import { placeOrder } from './order.service';
import { applyVerifiedEvent, assessPayable, startPaymentForOrder } from './payment-flow.service';
import { resetOrderTables } from './testing';

/**
 * The order↔payment seam against a real database (P11 §6/§13/§14/§15).
 *
 * The claims worth proving here are all *negative*: paying an order must not
 * take stock again, must not burn the coupon again, must not create a second
 * order, and must not move anything when the event is a duplicate. A test
 * that only shows the happy path shows none of that.
 */

let restore = () => {};

beforeEach(async () => {
  await resetPaymentTables();
  await resetOrderTables();
  await resetCartTables();
  await resetPricingTables();
  await resetCatalogTables();
  await db.customer.deleteMany();
  await db.user.deleteMany();
});

afterEach(() => {
  restore();
  restore = () => {};
});

let fixtureCounter = 0;

async function shoes(options: { priceMinor?: number; stockQuantity?: number } = {}) {
  fixtureCounter += 1;
  const n = fixtureCounter;
  const category = await createCategory({
    slug: `shoes-${n}`,
    nameAr: 'أحذية',
    nameEn: 'Shoes',
  });
  const product = await createProduct({
    product: {
      slug: `running-shoes-${n}`,
      nameAr: 'حذاء الجري',
      nameEn: 'Running Shoes',
      categoryId: category.id,
    },
    variants: [
      {
        sku: `RUN-BLK-${n}`,
        priceMinor: options.priceMinor ?? 40_000,
        stockQuantity: options.stockQuantity ?? 1,
      },
    ],
  });
  await publishProduct(product.id);
  return product.variants[0]!;
}

function checkoutInput() {
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
    idempotencyKey: randomUUID(),
  };
}

/** A real P10 order, placed the way a customer places one. */
async function placedOrder(options: { priceMinor?: number; couponCode?: string } = {}) {
  const variant = await shoes({ priceMinor: options.priceMinor ?? 40_000 });
  const guestToken = newGuestToken();
  const owner = { customerId: null, guestToken };
  await getOrCreateCart(owner);
  await addItem(owner, { variantId: variant.id, quantity: 1 });
  if (options.couponCode) {
    await createCoupon({
      code: options.couponCode,
      type: 'PERCENTAGE',
      value: 10,
      startsAt: new Date(Date.now() - 60_000),
    });
    await setCartCoupon(owner, options.couponCode);
  }
  const { order } = await placeOrder({ owner, input: checkoutInput() });
  return { order, variant };
}

const RETURN_URL = 'https://shop.example/ar/order/return';

describe('payability', () => {
  it('will not take money for an order that is already paid', async () => {
    const { order } = await placedOrder();
    await db.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID' } });
    const reloaded = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(assessPayable(reloaded)).toEqual({ payable: false, reason: 'already_paid' });
  });

  it('will not take money for a cancelled order', async () => {
    const { order } = await placedOrder();
    await db.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    const reloaded = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(assessPayable(reloaded).payable).toBe(false);
  });

  it('refuses a start on an unpayable order rather than opening a session', async () => {
    ({ restore } = stubPaymentProviderApi());
    const { order } = await placedOrder();
    await db.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });

    await expect(
      startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await db.payment.count()).toBe(0);
  });
});

describe('starting a payment', () => {
  it('sends the stored order total, not anything a caller supplies', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { order } = await placedOrder({ priceMinor: 40_000, couponCode: 'TENOFF1' });

    // 40 000 minus 10% = 36 000. The order already holds that number.
    expect(order.totalMinor).toBe(36_000);

    const { payment } = await startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL });

    expect(payment.amountMinor).toBe(order.totalMinor);
    expect(payment.currency).toBe(order.currency);
    expect(stub.sessions[0]!.amount).toBe(36_000);
  });

  it('moves the order to PENDING and writes a timeline entry', async () => {
    ({ restore } = stubPaymentProviderApi());
    const { order } = await placedOrder();

    await startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL });

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.paymentStatus).toBe('PENDING');
    const events = await db.orderEvent.findMany({
      where: { orderId: order.id, type: 'PAYMENT_STATUS' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.toValue).toBe('PENDING');
  });

  it('reuses the live attempt instead of opening a second one', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { order } = await placedOrder();

    const first = await startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL });
    const second = await startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL });

    expect(second.reused).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(1);
    // And exactly one provider session was ever opened.
    expect(stub.sessions).toHaveLength(1);
  });

  it('frees the slot when the provider call fails, so the customer can retry', async () => {
    const failing = stubPaymentProviderApi({ failCreate: true });
    const { order } = await placedOrder();

    await expect(
      startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL }),
    ).rejects.toMatchObject({ code: 'PAYMENT_FAILED' });

    const attempt = await db.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(attempt.status).toBe('FAILED');
    expect(attempt.failureCode).toBe('provider_unavailable');

    failing.restore();
    const working = stubPaymentProviderApi();
    restore = working.restore;
    const retry = await startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL });
    expect(retry.payment.status).toBe('CREATED');
    expect(retry.reused).toBe(false);
  });
});

describe('a verified success', () => {
  async function paidOrder(couponCode?: string) {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { order, variant } = await placedOrder({ couponCode });
    const { payment } = await startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL });
    const event = verifiedEvent({
      reference: payment.providerReference!,
      status: 'SUCCEEDED',
      amountMinor: payment.amountMinor,
      currency: payment.currency,
    });
    const result = await applyVerifiedEvent({
      provider: 'HOSTED_CHECKOUT',
      event,
      rawPayload: { id: payment.providerReference, status: 'paid' },
    });
    return { order, variant, payment, event, result };
  }

  it('marks the attempt paid and confirms the order', async () => {
    const { order, payment, result } = await paidOrder();
    expect(result.kind).toBe('processed');

    const attempt = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(attempt.status).toBe('SUCCEEDED');
    expect(attempt.paidAt).not.toBeNull();

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.paymentStatus).toBe('PAID');
    // Money arriving is what confirms an order.
    expect(after.status).toBe('CONFIRMED');
    expect(after.confirmedAt).not.toBeNull();
  });

  it('does not take stock a second time', async () => {
    const { variant } = await paidOrder();
    // P10 took the one unit at order creation. Payment must not take another.
    const after = await db.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(after.stockQuantity).toBe(0);
    const movements = await db.inventoryAdjustment.findMany({ where: { variantId: variant.id } });
    expect(movements.filter((m) => m.reason === 'SALE')).toHaveLength(1);
  });

  it('does not consume the coupon a second time', async () => {
    const { order } = await paidOrder('TENOFF2');
    const redemptions = await db.couponRedemption.findMany({ where: { orderId: order.id } });
    expect(redemptions).toHaveLength(1);
  });

  it('does not create another order, or touch the items', async () => {
    const { order } = await paidOrder();
    expect(await db.order.count()).toBe(1);
    const items = await db.orderItem.findMany({ where: { orderId: order.id } });
    expect(items).toHaveLength(1);
    expect(items[0]!.unitPriceMinor).toBe(40_000);
  });

  it('records the outbox event P13 will deliver, and sends nothing itself', async () => {
    const { order } = await paidOrder();
    const outbox = await db.outboxEvent.findMany({ where: { type: 'payment.succeeded' } });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.status).toBe('PENDING');
    expect(outbox[0]!.sentAt).toBeNull();
    expect(outbox[0]!.payload).toMatchObject({ orderId: order.id });
  });

  it('writes an audit entry with a null actor, because a provider is not a user', async () => {
    const { order } = await paidOrder();
    const audit = await db.auditLog.findFirst({
      where: { entityId: order.id, action: 'order.payment_changed' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.userId).toBeNull();
    expect(audit!.after).toMatchObject({ paymentStatus: 'PAID' });
  });
});

describe('duplicate and out-of-order delivery', () => {
  async function started() {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { order, variant } = await placedOrder({ couponCode: `DUP${Date.now() % 100000}` });
    const { payment } = await startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL });
    return { order, variant, payment };
  }

  it('processes the same event id exactly once', async () => {
    const { order, payment } = await started();
    const event = verifiedEvent({
      reference: payment.providerReference!,
      status: 'SUCCEEDED',
      amountMinor: payment.amountMinor,
      currency: payment.currency,
    });

    const first = await applyVerifiedEvent({ provider: 'HOSTED_CHECKOUT', event, rawPayload: {} });
    const second = await applyVerifiedEvent({ provider: 'HOSTED_CHECKOUT', event, rawPayload: {} });
    const third = await applyVerifiedEvent({ provider: 'HOSTED_CHECKOUT', event, rawPayload: {} });

    expect(first.kind).toBe('processed');
    expect(second.kind).toBe('duplicate');
    expect(third.kind).toBe('duplicate');

    // One transition, one timeline entry, one outbox event.
    const paidEvents = await db.orderEvent.findMany({
      where: { orderId: order.id, type: 'PAYMENT_STATUS', toValue: 'PAID' },
    });
    expect(paidEvents).toHaveLength(1);
    expect(await db.outboxEvent.count({ where: { type: 'payment.succeeded' } })).toBe(1);
    expect(await db.couponRedemption.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('will not let a stale event walk a paid payment backwards', async () => {
    const { order, payment } = await started();
    const paidAt = new Date('2026-09-02T12:00:05Z');

    await applyVerifiedEvent({
      provider: 'HOSTED_CHECKOUT',
      event: verifiedEvent({
        reference: payment.providerReference!,
        status: 'SUCCEEDED',
        occurredAt: paidAt,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
      }),
      rawPayload: {},
    });

    // The retried PENDING that was emitted first but arrived second.
    const stale = await applyVerifiedEvent({
      provider: 'HOSTED_CHECKOUT',
      event: verifiedEvent({
        reference: payment.providerReference!,
        status: 'PENDING',
        occurredAt: new Date(paidAt.getTime() - 4000),
      }),
      rawPayload: {},
    });

    expect(stale.kind).toBe('ignored');
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'SUCCEEDED',
    );
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe(
      'PAID',
    );
  });

  it('will not let a *newer* event move a settled attempt either', async () => {
    const { order, payment } = await started();
    await applyVerifiedEvent({
      provider: 'HOSTED_CHECKOUT',
      event: verifiedEvent({
        reference: payment.providerReference!,
        status: 'SUCCEEDED',
        occurredAt: new Date('2026-09-02T12:00:00Z'),
        amountMinor: payment.amountMinor,
        currency: payment.currency,
      }),
      rawPayload: {},
    });

    // A provider that later claims the same session failed does not get to
    // un-pay it; that is a refund, which is a different operation.
    const later = await applyVerifiedEvent({
      provider: 'HOSTED_CHECKOUT',
      event: verifiedEvent({
        reference: payment.providerReference!,
        status: 'FAILED',
        occurredAt: new Date('2026-09-02T13:00:00Z'),
      }),
      rawPayload: {},
    });

    expect(later).toEqual({ kind: 'ignored', reason: 'terminal' });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe(
      'PAID',
    );
  });

  it('records a signed event for a session it never opened, and does nothing else', async () => {
    await started();
    const result = await applyVerifiedEvent({
      provider: 'HOSTED_CHECKOUT',
      event: verifiedEvent({ reference: 'sess_never_issued', status: 'SUCCEEDED' }),
      rawPayload: {},
    });

    expect(result.kind).toBe('unknown_reference');
    expect(await db.payment.count({ where: { status: 'SUCCEEDED' } })).toBe(0);
    const row = await db.webhookEvent.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    expect(row.error).toBe('unknown_reference');
    expect(row.paymentId).toBeNull();
  });
});

describe('the provider does not get to change the amount', () => {
  it('refuses a success whose amount disagrees with the attempt', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { order } = await placedOrder();
    const { payment } = await startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL });

    const result = await applyVerifiedEvent({
      provider: 'HOSTED_CHECKOUT',
      event: verifiedEvent({
        reference: payment.providerReference!,
        status: 'SUCCEEDED',
        amountMinor: 1,
        currency: 'SAR',
      }),
      rawPayload: {},
    });

    expect(result).toMatchObject({ kind: 'rejected', reason: 'amount_mismatch' });
    const attempt = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(attempt.status).toBe('FAILED');
    expect(attempt.failureCode).toBe('amount_mismatch');
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.paymentStatus).toBe('FAILED');
    expect(after.status).not.toBe('CONFIRMED');
  });

  it('refuses a success in a different currency', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { order } = await placedOrder();
    const { payment } = await startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL });

    const result = await applyVerifiedEvent({
      provider: 'HOSTED_CHECKOUT',
      event: verifiedEvent({
        reference: payment.providerReference!,
        status: 'SUCCEEDED',
        amountMinor: payment.amountMinor,
        currency: 'USD',
      }),
      rawPayload: {},
    });

    expect(result).toMatchObject({ kind: 'rejected', reason: 'amount_mismatch' });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).not.toBe(
      'PAID',
    );
  });
});

describe('failure and retry', () => {
  it('lets a customer retry after a decline, keeping both attempts', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { order } = await placedOrder();

    const first = await startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL });
    await applyVerifiedEvent({
      provider: 'HOSTED_CHECKOUT',
      event: verifiedEvent({
        reference: first.payment.providerReference!,
        status: 'FAILED',
        failureCode: 'card_declined',
      }),
      rawPayload: {},
    });

    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe(
      'FAILED',
    );

    // A second attempt is allowed, because the first no longer occupies the
    // live slot.
    const second = await startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL });
    expect(second.payment.id).not.toBe(first.payment.id);

    await applyVerifiedEvent({
      provider: 'HOSTED_CHECKOUT',
      event: verifiedEvent({
        reference: second.payment.providerReference!,
        status: 'SUCCEEDED',
        amountMinor: second.payment.amountMinor,
        currency: second.payment.currency,
      }),
      rawPayload: {},
    });

    // Both attempts survive: the decline is still on the record.
    const attempts = await db.payment.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(attempts).toHaveLength(2);
    expect(attempts[0]!.status).toBe('FAILED');
    expect(attempts[0]!.failureCode).toBe('card_declined');
    expect(attempts[1]!.status).toBe('SUCCEEDED');

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.paymentStatus).toBe('PAID');
    expect(after.status).toBe('CONFIRMED');
    // And still exactly one order, one set of items, one stock movement.
    expect(await db.order.count()).toBe(1);
  });

  it('returns an abandoned order to unpaid, not to failed', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { order } = await placedOrder();
    const { payment } = await startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL });

    await applyVerifiedEvent({
      provider: 'HOSTED_CHECKOUT',
      event: verifiedEvent({ reference: payment.providerReference!, status: 'EXPIRED' }),
      rawPayload: {},
    });

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.paymentStatus).toBe('UNPAID');
    expect(after.status).toBe('PENDING_PAYMENT');
    expect(assessPayable(after).payable).toBe(true);
  });
});

describe('cancelling an order closes its payment session', () => {
  it('does not leave a live attempt behind', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { order } = await placedOrder();
    const { payment } = await startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL });

    const { cancelOrder } = await import('./order.service');
    await cancelOrder(order.id);

    const attempt = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(attempt.status).toBe('CANCELLED');
  });
});
