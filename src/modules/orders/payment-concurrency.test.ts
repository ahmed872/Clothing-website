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
import { applyVerifiedEvent, startPaymentForOrder } from './payment-flow.service';
import { resetOrderTables } from './testing';

/**
 * Races (P11 §27).
 *
 * Every test here runs the operations genuinely in parallel with
 * `Promise.all` and asserts on the state afterwards. Awaiting them in
 * sequence would prove nothing: the bugs being hunted only exist when two
 * transactions overlap, and both of these are arbitrated by the database —
 * a partial unique index for payment creation, and a unique constraint for
 * webhook delivery — precisely because an application-level check cannot be.
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

let n = 0;

async function placedOrder(withCoupon = false) {
  n += 1;
  const category = await createCategory({ slug: `shoes-c${n}`, nameAr: 'أحذية', nameEn: 'Shoes' });
  const product = await createProduct({
    product: {
      slug: `running-shoes-c${n}`,
      nameAr: 'حذاء الجري',
      nameEn: 'Running Shoes',
      categoryId: category.id,
    },
    variants: [{ sku: `RUN-C${n}`, priceMinor: 40_000, stockQuantity: 1 }],
  });
  await publishProduct(product.id);
  const variant = product.variants[0]!;

  const owner = { customerId: null, guestToken: newGuestToken() };
  await getOrCreateCart(owner);
  await addItem(owner, { variantId: variant.id, quantity: 1 });
  if (withCoupon) {
    const code = `RACE${n}`;
    await createCoupon({
      code,
      type: 'PERCENTAGE',
      value: 10,
      startsAt: new Date(Date.now() - 60_000),
    });
    await setCartCoupon(owner, code);
  }

  const { order } = await placeOrder({
    owner,
    input: {
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
    },
  });
  return { order, variant };
}

const RETURN_URL = 'https://shop.example/ar/order/x/payment';

describe('two concurrent attempts to start a payment', () => {
  it('opens exactly one live attempt', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { order } = await placedOrder();

    const results = await Promise.allSettled([
      startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL }),
      startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL }),
    ]);

    // Both callers get an answer; neither is left with an error, because a
    // double-click is not a failure.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const attempts = await db.payment.findMany({ where: { orderId: order.id } });
    expect(attempts).toHaveLength(1);
    expect(
      attempts.filter((a) => ['CREATED', 'REQUIRES_ACTION', 'PENDING'].includes(a.status)),
    ).toHaveLength(1);
  });

  it('opens exactly one live attempt under five simultaneous clicks', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { order } = await placedOrder();

    await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL }),
      ),
    );

    const live = await db.payment.findMany({
      where: { orderId: order.id, status: { in: ['CREATED', 'REQUIRES_ACTION', 'PENDING'] } },
    });
    expect(live).toHaveLength(1);
  });

  it('is enforced by the database, not by a read-then-write check', async () => {
    // Proves the partial unique index is real: a direct insert that bypasses
    // every line of application code is still refused.
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { order } = await placedOrder();
    await startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL });

    await expect(
      db.payment.create({
        data: {
          orderId: order.id,
          provider: 'HOSTED_CHECKOUT',
          status: 'PENDING',
          amountMinor: order.totalMinor,
          currency: order.currency,
          idempotencyKey: randomUUID(),
        },
      }),
    ).rejects.toThrow();
  });

  it('still allows a second attempt once the first has settled', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { order } = await placedOrder();
    const first = await startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL });

    await applyVerifiedEvent({
      provider: 'HOSTED_CHECKOUT',
      event: verifiedEvent({ reference: first.payment.providerReference!, status: 'FAILED' }),
      rawPayload: {},
    });

    const second = await startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL });
    expect(second.payment.id).not.toBe(first.payment.id);
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(2);
  });
});

describe('the same webhook delivered concurrently', () => {
  async function started(withCoupon = false) {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { order, variant } = await placedOrder(withCoupon);
    const { payment } = await startPaymentForOrder({ orderId: order.id, returnUrl: RETURN_URL });
    return { order, variant, payment };
  }

  it('produces one transition, not four', async () => {
    const { order, payment } = await started();
    const event = verifiedEvent({
      reference: payment.providerReference!,
      status: 'SUCCEEDED',
      amountMinor: payment.amountMinor,
      currency: payment.currency,
    });

    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () =>
        applyVerifiedEvent({ provider: 'HOSTED_CHECKOUT', event, rawPayload: {} }),
      ),
    );

    // Exactly one processed it; the rest saw a duplicate.
    expect(outcomes.filter((o) => o.kind === 'processed')).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === 'duplicate')).toHaveLength(3);

    expect(await db.webhookEvent.count({ where: { externalEventId: event.externalEventId } })).toBe(
      1,
    );
    const paidEvents = await db.orderEvent.findMany({
      where: { orderId: order.id, type: 'PAYMENT_STATUS', toValue: 'PAID' },
    });
    expect(paidEvents).toHaveLength(1);
  });

  it('produces no duplicate side effects at all', async () => {
    const { order, variant, payment } = await started(true);
    const event = verifiedEvent({
      reference: payment.providerReference!,
      status: 'SUCCEEDED',
      amountMinor: payment.amountMinor,
      currency: payment.currency,
    });

    await Promise.all(
      Array.from({ length: 4 }, () =>
        applyVerifiedEvent({ provider: 'HOSTED_CHECKOUT', event, rawPayload: {} }),
      ),
    );

    // Stock: taken once, by P10, at order creation.
    const after = await db.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(after.stockQuantity).toBe(0);
    expect(
      await db.inventoryAdjustment.count({ where: { variantId: variant.id, reason: 'SALE' } }),
    ).toBe(1);

    // Coupon: redeemed once, by P10.
    expect(await db.couponRedemption.count({ where: { orderId: order.id } })).toBe(1);

    // One order, one confirmation, one outbox event for P13 to deliver.
    expect(await db.order.count()).toBe(1);
    expect(await db.outboxEvent.count({ where: { type: 'payment.succeeded' } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { type: 'order.confirmed' } })).toBe(1);
  });

  it('survives a success and a stale pending arriving together', async () => {
    const { order, payment } = await started();
    const paidAt = new Date('2026-09-03T12:00:05Z');

    await Promise.all([
      applyVerifiedEvent({
        provider: 'HOSTED_CHECKOUT',
        event: verifiedEvent({
          reference: payment.providerReference!,
          status: 'SUCCEEDED',
          occurredAt: paidAt,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
        }),
        rawPayload: {},
      }),
      applyVerifiedEvent({
        provider: 'HOSTED_CHECKOUT',
        event: verifiedEvent({
          reference: payment.providerReference!,
          status: 'PENDING',
          occurredAt: new Date(paidAt.getTime() - 5000),
        }),
        rawPayload: {},
      }),
    ]);

    // Whichever landed first, the settled state is the one that stands: a
    // paid attempt is terminal and a stale event is refused.
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'SUCCEEDED',
    );
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe(
      'PAID',
    );
  });

  it('is enforced by the database, not by a read-then-write check', async () => {
    const { payment } = await started();
    await db.webhookEvent.create({
      data: {
        provider: 'HOSTED_CHECKOUT',
        externalEventId: 'evt_direct',
        eventType: 'payment.paid',
        signatureValid: true,
        paymentId: payment.id,
        payload: {},
      },
    });

    await expect(
      db.webhookEvent.create({
        data: {
          provider: 'HOSTED_CHECKOUT',
          externalEventId: 'evt_direct',
          eventType: 'payment.paid',
          signatureValid: true,
          payload: {},
        },
      }),
    ).rejects.toThrow();
  });
});
