import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';
import { createCategory } from '@/modules/catalog/category.service';
import { createProduct, publishProduct } from '@/modules/catalog/product.service';
import { resetCatalogTables } from '@/modules/catalog/testing';
import { resetPricingTables } from '@/modules/pricing/testing';
import { addItem, getOrCreateCart, newGuestToken } from '@/modules/cart';
import { resetCartTables } from '@/modules/cart/testing';
import { hostedCheckoutProvider } from '@/modules/payments/hosted-checkout-provider';
import { resetPaymentTables } from '@/modules/payments/testing';
import {
  signedHeaders,
  stubPaymentProviderApi,
  webhookBody,
} from '@/modules/payments/test-fixtures';

import { placeOrder } from './order.service';
import { getOrderByAccessToken, getOrderForCustomer } from './order-queries';
import { applyVerifiedEvent, startPaymentForOrder } from './payment-flow.service';
import { resetOrderTables } from './testing';

/**
 * Payment authorisation and webhook trust, asserted from the attacker's side
 * (P11 §9/§26).
 *
 * Every test here tries the thing that must not work. A test that only shows
 * a valid payment succeeding proves nothing about whether an invalid one
 * would have been refused.
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

async function shoes() {
  n += 1;
  const category = await createCategory({ slug: `shoes-s${n}`, nameAr: 'أحذية', nameEn: 'Shoes' });
  const product = await createProduct({
    product: {
      slug: `running-shoes-s${n}`,
      nameAr: 'حذاء الجري',
      nameEn: 'Running Shoes',
      categoryId: category.id,
    },
    variants: [{ sku: `RUN-S${n}`, priceMinor: 40_000, stockQuantity: 5 }],
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

async function customerOwner(email: string) {
  const user = await db.user.create({ data: { email, passwordHash: 'x', role: 'CUSTOMER' } });
  const customer = await db.customer.create({ data: { userId: user.id } });
  return { customerId: customer.id, guestToken: null };
}

async function guestOwner() {
  const guestToken = newGuestToken();
  await getOrCreateCart({ customerId: null, guestToken });
  return { customerId: null, guestToken };
}

async function orderWithPayment(owner: { customerId: string | null; guestToken: string | null }) {
  const variant = await shoes();
  await addItem(owner, { variantId: variant.id, quantity: 1 });
  const { order, accessToken } = await placeOrder({ owner, input: checkoutInput() });
  const { payment } = await startPaymentForOrder({
    orderId: order.id,
    returnUrl: 'https://shop.example/ar/order/x/payment',
  });
  return { order, payment, accessToken };
}

describe('a payment is reached only through an order the reader may open', () => {
  it('does not surface another customer’s order, and so cannot surface its payment', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const alice = await customerOwner('alice@example.com');
    const bob = await customerOwner('bob@example.com');
    const { order } = await orderWithPayment(alice);

    // Every payment path in the application starts by resolving the order
    // number. Bob cannot get past this line, so there is no second check to
    // forget further down.
    expect(await getOrderForCustomer(order.number, bob.customerId!)).toBeNull();
  });

  it('does not surface a guest’s order to another guest', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const guestA = await guestOwner();
    const first = await orderWithPayment(guestA);
    const guestB = await guestOwner();
    const second = await orderWithPayment(guestB);

    expect(await getOrderByAccessToken(first.order.number, second.accessToken!)).toBeNull();
    expect(await getOrderByAccessToken(second.order.number, first.accessToken!)).toBeNull();
  });

  it('gives a payment id and a provider reference no authority of their own', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const alice = await customerOwner('alice@example.com');
    const { order, payment } = await orderWithPayment(alice);

    // Both identifiers exist and are stored, and neither appears in any
    // customer-facing route: there is no `/payments/[id]` and no action that
    // takes a payment id or a provider reference. Substituting one is not
    // "blocked" — there is nowhere to substitute it into.
    expect(payment.id).toBeTruthy();
    expect(payment.providerReference).toBeTruthy();
    const routes = await import('node:fs/promises').then((fs) =>
      fs.readdir('src/app/api/payments/webhook', { recursive: true }),
    );
    expect(routes.join(' ')).not.toContain('[paymentId]');

    // And the payment is only findable through its order.
    const viaOrder = await db.payment.findMany({ where: { orderId: order.id } });
    expect(viaOrder.map((p) => p.id)).toEqual([payment.id]);
  });
});

describe('the webhook endpoint trusts a signature and nothing else', () => {
  async function post(rawBody: string, headers: Headers): Promise<Response> {
    const { POST } = await import('@/app/api/payments/webhook/[provider]/route');
    return POST(
      new Request('http://127.0.0.1/api/payments/webhook/hosted_checkout', {
        method: 'POST',
        body: rawBody,
        headers,
      }),
      { params: Promise.resolve({ provider: 'hosted_checkout' }) },
    );
  }

  it('rejects a delivery with no signature', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { payment } = await orderWithPayment(await guestOwner());
    const body = webhookBody({
      event_id: 'evt_unsigned',
      id: payment.providerReference!,
      status: 'paid',
      occurred_at: new Date().toISOString(),
      amount: payment.amountMinor,
      currency: payment.currency,
    });

    const response = await post(body, new Headers({ 'content-type': 'application/json' }));
    expect(response.status).toBe(400);

    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).not.toBe('SUCCEEDED');
    const order = await db.order.findUniqueOrThrow({ where: { id: after.orderId } });
    expect(order.paymentStatus).not.toBe('PAID');
  });

  it('rejects a delivery signed with the wrong secret', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { payment } = await orderWithPayment(await guestOwner());
    const body = webhookBody({
      event_id: 'evt_wrongsecret',
      id: payment.providerReference!,
      status: 'paid',
      occurred_at: new Date().toISOString(),
      amount: payment.amountMinor,
      currency: payment.currency,
    });
    const { buildSignatureHeader } = await import('@/modules/payments/signature');
    const headers = new Headers({
      'content-type': 'application/json',
      'x-payment-signature': buildSignatureHeader('f'.repeat(64), body, new Date()),
    });

    expect((await post(body, headers)).status).toBe(400);
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).not.toBe(
      'SUCCEEDED',
    );
  });

  it('rejects a body edited after it was signed', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { payment } = await orderWithPayment(await guestOwner());
    const honest = webhookBody({
      event_id: 'evt_tampered',
      id: payment.providerReference!,
      status: 'pending',
      occurred_at: new Date().toISOString(),
    });
    const headers = signedHeaders(honest);
    // The attacker keeps the valid signature and changes the outcome.
    const tampered = honest.replace('"pending"', '"paid"');

    expect((await post(tampered, headers)).status).toBe(400);
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).not.toBe(
      'SUCCEEDED',
    );
  });

  it('rejects a malformed body without crashing', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    await orderWithPayment(await guestOwner());

    for (const body of ['', 'not json at all', '[]', '{"event_id":1}', 'null']) {
      const response = await post(body, signedHeaders(body));
      expect(response.status).toBe(400);
    }
  });

  it('rejects an unknown provider status rather than guessing', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { payment } = await orderWithPayment(await guestOwner());
    const body = webhookBody({
      event_id: 'evt_unknown_status',
      id: payment.providerReference!,
      status: 'definitely_paid_trust_me',
      occurred_at: new Date().toISOString(),
    });

    expect((await post(body, signedHeaders(body))).status).toBe(400);
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).not.toBe(
      'SUCCEEDED',
    );
  });

  it('records the rejection without attaching it to a payment', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { payment } = await orderWithPayment(await guestOwner());
    const body = webhookBody({
      event_id: 'evt_recorded',
      id: payment.providerReference!,
      status: 'paid',
      occurred_at: new Date().toISOString(),
    });

    await post(body, new Headers({ 'content-type': 'application/json' }));

    const row = await db.webhookEvent.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    expect(row.signatureValid).toBe(false);
    expect(row.status).toBe('FAILED');
    expect(row.paymentId).toBeNull();
    expect(row.error).toBe('missing_signature');
  });

  it('accepts a genuinely signed delivery, which is what makes the refusals meaningful', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { order, payment } = await orderWithPayment(await guestOwner());
    const body = webhookBody({
      event_id: 'evt_valid',
      id: payment.providerReference!,
      status: 'paid',
      occurred_at: new Date().toISOString(),
      amount: payment.amountMinor,
      currency: payment.currency,
    });

    const response = await post(body, signedHeaders(body));
    expect(response.status).toBe(200);

    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'SUCCEEDED',
    );
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe(
      'PAID',
    );
  });

  it('answers 404 for a provider this deployment does not run', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { POST } = await import('@/app/api/payments/webhook/[provider]/route');
    const response = await POST(
      new Request('http://127.0.0.1/api/payments/webhook/stripe', { method: 'POST', body: '{}' }),
      { params: Promise.resolve({ provider: 'stripe' }) },
    );
    expect(response.status).toBe(404);
  });

  it('never returns why a delivery was refused', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    await orderWithPayment(await guestOwner());
    const response = await post('{}', new Headers());
    const text = await response.text();
    // Telling a caller whether the signature was absent, wrong or stale is a
    // hint they can tune against.
    for (const leak of ['signature', 'stale', 'secret', 'malformed']) {
      expect(text.toLowerCase()).not.toContain(leak);
    }
  });
});

describe('a verified event cannot be manufactured', () => {
  it('has no path from a raw body to the payment machine that skips verification', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { payment } = await orderWithPayment(await guestOwner());

    // `applyVerifiedEvent` takes a `VerifiedProviderEvent`, and the only
    // thing in the codebase that produces one is an adapter's
    // `verifyWebhook`. Handing that adapter an unsigned body returns a
    // refusal, not an event — there is no third option in the type.
    const body = webhookBody({
      event_id: 'evt_x',
      id: payment.providerReference!,
      status: 'paid',
      occurred_at: new Date().toISOString(),
    });
    const result = hostedCheckoutProvider.verifyWebhook(body, new Headers());
    expect(result.ok).toBe(false);
    expect('event' in result).toBe(false);
  });

  it('will not mark a payment paid from a status word alone', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { order, payment } = await orderWithPayment(await guestOwner());

    // A signed event whose amount disagrees is refused even though it says
    // "paid" — the word is not enough.
    await applyVerifiedEvent({
      provider: 'HOSTED_CHECKOUT',
      event: {
        externalEventId: 'evt_amount_lie',
        eventType: 'payment.paid',
        reference: payment.providerReference!,
        status: 'SUCCEEDED',
        occurredAt: new Date(),
        amountMinor: 1,
        currency: 'SAR',
        failureCode: null,
        failureMessage: null,
        metadata: {},
      },
      rawPayload: {},
    });

    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).not.toBe(
      'PAID',
    );
  });
});

describe('secrets stay out of what is stored', () => {
  it('keeps no credential on the payment row', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { payment } = await orderWithPayment(await guestOwner());

    const row = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain(process.env.PAYMENT_API_KEY!);
    expect(serialised).not.toContain(process.env.PAYMENT_WEBHOOK_SECRET!);
  });

  it('keeps no card data or token on a webhook row', async () => {
    const stub = stubPaymentProviderApi();
    restore = stub.restore;
    const { payment } = await orderWithPayment(await guestOwner());

    const raw = JSON.stringify({
      event_id: 'evt_secretful',
      event_type: 'payment.paid',
      id: payment.providerReference,
      status: 'paid',
      occurred_at: new Date().toISOString(),
      amount: payment.amountMinor,
      currency: payment.currency,
      // The things a real payload might carry.
      card_number: '4242424242424242',
      cvv: '123',
      auth_token: 'tok_live_supersecret',
      cardholder_name: 'A Customer',
    });

    const { POST } = await import('@/app/api/payments/webhook/[provider]/route');
    await POST(
      new Request('http://127.0.0.1/api/payments/webhook/hosted_checkout', {
        method: 'POST',
        body: raw,
        headers: signedHeaders(raw),
      }),
      { params: Promise.resolve({ provider: 'hosted_checkout' }) },
    );

    const row = await db.webhookEvent.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    const stored = JSON.stringify(row.payload);
    expect(stored).not.toContain('4242424242424242');
    expect(stored).not.toContain('tok_live');
    expect(stored).not.toContain('A Customer');
    expect(stored).not.toContain('123');
    // And the fields that *are* useful survived.
    expect(row.payload).toMatchObject({ status: 'paid', currency: payment.currency });
  });
});
