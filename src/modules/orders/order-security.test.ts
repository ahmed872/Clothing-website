import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';
import { createCategory } from '@/modules/catalog/category.service';
import { createProduct, publishProduct } from '@/modules/catalog/product.service';
import { resetCatalogTables } from '@/modules/catalog/testing';
import { resetPricingTables } from '@/modules/pricing/testing';
import { addItem, getOrCreateCart, newGuestToken } from '@/modules/cart';
import { resetCartTables } from '@/modules/cart/testing';

import { placeOrder, cancelOrder, transitionOrderStatus } from './order.service';
import {
  getOrderByAccessToken,
  getOrderForAdmin,
  getOrderForCustomer,
  getOrderIdByNumber,
  listCustomerOrders,
} from './order-queries';
import { generateOrderAccessToken, hashOrderAccessToken } from './order-identifiers';
import { placeOrderInputSchema } from './checkout-schemas';
import { resetOrderTables } from './testing';

/**
 * Authorisation, asserted from the attacker's side (P10 §31).
 *
 * Each test tries the thing that must not work and asserts that it does not.
 * A test that only proves the happy path is not a security test — it is the
 * same test the feature already has.
 */

beforeEach(async () => {
  await resetOrderTables();
  await resetCartTables();
  await resetPricingTables();
  await resetCatalogTables();
  await db.customer.deleteMany();
  await db.user.deleteMany();
});

/** Unique per call: several tests here place two orders, and a fixed slug
 * would collide on the second product rather than testing anything. */
let fixtureCounter = 0;

async function shoes(stockQuantity = 10) {
  fixtureCounter += 1;
  const suffix = fixtureCounter;
  const category = await createCategory({
    slug: `shoes-${suffix}`,
    nameAr: 'أحذية',
    nameEn: 'Shoes',
  });
  const product = await createProduct({
    product: {
      slug: `running-shoes-${suffix}`,
      nameAr: 'حذاء الجري',
      nameEn: 'Running Shoes',
      categoryId: category.id,
    },
    variants: [{ sku: `RUN-BLK-${suffix}`, priceMinor: 45_000, stockQuantity }],
  });
  await publishProduct(product.id);
  return product.variants[0]!;
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

function checkoutInput(key = randomUUID()) {
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
    idempotencyKey: key,
  };
}

async function orderFor(owner: { customerId: string | null; guestToken: string | null }) {
  const variant = await shoes();
  await addItem(owner, { variantId: variant.id, quantity: 1 });
  return placeOrder({ owner, input: checkoutInput() });
}

describe('customer order isolation (IDOR)', () => {
  it('does not return another customer’s order, even with the right number', async () => {
    const alice = await customerOwner('alice@example.com');
    const bob = await customerOwner('bob@example.com');
    const { order } = await orderFor(alice);

    expect(await getOrderForCustomer(order.number, bob.customerId!)).toBeNull();
  });

  it('returns null rather than a different error, so it cannot be used as an oracle', async () => {
    const bob = await customerOwner('bob@example.com');
    const alice = await customerOwner('alice@example.com');
    const { order } = await orderFor(alice);

    const forSomeoneElsesRealOrder = await getOrderForCustomer(order.number, bob.customerId!);
    const forAnInventedOrder = await getOrderForCustomer('LD-260902-ZZZZZZ', bob.customerId!);

    // Identical responses: an attacker learns nothing about which numbers exist.
    expect(forSomeoneElsesRealOrder).toBeNull();
    expect(forAnInventedOrder).toBeNull();
  });

  it('never lists another customer’s orders', async () => {
    const alice = await customerOwner('alice@example.com');
    const bob = await customerOwner('bob@example.com');
    await orderFor(alice);

    const bobsList = await listCustomerOrders(bob.customerId!);
    expect(bobsList.items).toHaveLength(0);
    expect(bobsList.total).toBe(0);
  });

  it('does not hand a guest order to a signed-in customer by number', async () => {
    const guest = await guestOwner();
    const { order } = await orderFor(guest);
    const alice = await customerOwner('alice@example.com');

    expect(await getOrderForCustomer(order.number, alice.customerId!)).toBeNull();
  });
});

describe('guest order access', () => {
  it('opens only with the matching token', async () => {
    const guest = await guestOwner();
    const { order, accessToken } = await orderFor(guest);
    expect(accessToken).toBeTruthy();

    expect(await getOrderByAccessToken(order.number, accessToken!)).not.toBeNull();
  });

  it('refuses a different guest’s token', async () => {
    const guestA = await guestOwner();
    const { order } = await orderFor(guestA);

    const otherToken = generateOrderAccessToken();
    expect(await getOrderByAccessToken(order.number, otherToken)).toBeNull();
  });

  it('refuses the right token against the wrong order number', async () => {
    const guestA = await guestOwner();
    const first = await orderFor(guestA);
    const guestB = await guestOwner();
    const second = await orderFor(guestB);

    expect(await getOrderByAccessToken(second.order.number, first.accessToken!)).toBeNull();
  });

  it('refuses an empty or malformed token', async () => {
    const guest = await guestOwner();
    const { order } = await orderFor(guest);

    expect(await getOrderByAccessToken(order.number, '')).toBeNull();
    expect(await getOrderByAccessToken(order.number, 'not-a-token')).toBeNull();
  });

  it('stores only the hash, so a database read does not open the order', async () => {
    const guest = await guestOwner();
    const { order, accessToken } = await orderFor(guest);

    const row = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.accessTokenHash).not.toBe(accessToken);
    expect(row.accessTokenHash).toBe(hashOrderAccessToken(accessToken!));
    expect(row.accessTokenHash).not.toContain(accessToken!.slice(0, 8));
  });

  it('rejects an order number that is not even our shape, without querying', async () => {
    expect(await getOrderByAccessToken("' OR 1=1--", 'x')).toBeNull();
    expect(await getOrderForCustomer('../../etc/passwd', randomUUID())).toBeNull();
    expect(await getOrderForAdmin('100001')).toBeNull();
    expect(await getOrderIdByNumber('LD-1-1')).toBeNull();
  });
});

describe('the client cannot dictate commercial facts', () => {
  it('has no field for a price, total, discount, status or stock', () => {
    const shape = Object.keys(placeOrderInputSchema.shape);
    for (const forbidden of [
      'totalMinor',
      'subtotalMinor',
      'discountMinor',
      'unitPriceMinor',
      'status',
      'paymentStatus',
      'stockQuantity',
      'cartId',
      'customerId',
    ]) {
      expect(shape).not.toContain(forbidden);
    }
  });

  it('ignores injected commercial fields and prices from the catalog instead', async () => {
    const variant = await shoes();
    const owner = await customerOwner('shopper@example.com');
    await addItem(owner, { variantId: variant.id, quantity: 2 });

    const tampered = {
      ...checkoutInput(),
      // Everything an attacker would try to set.
      totalMinor: 1,
      subtotalMinor: 1,
      discountMinor: 89_999,
      status: 'COMPLETED',
      paymentStatus: 'PAID',
    } as never;

    const { order } = await placeOrder({ owner, input: tampered });

    // Server truth: 2 × 45 000, no discount, still awaiting payment.
    expect(order.subtotalMinor).toBe(90_000);
    expect(order.discountMinor).toBe(0);
    expect(order.totalMinor).toBe(90_000);
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.paymentStatus).toBe('UNPAID');
  });

  it('cannot mark an order paid through the status machine', async () => {
    const owner = await customerOwner('shopper@example.com');
    const { order } = await orderFor(owner);

    // There is no order-status transition that touches payment at all, and
    // the one that would (`UNPAID → PAID`) is P11's to make, through the
    // payment machine, from a verified webhook.
    await expect(transitionOrderStatus(order.id, 'COMPLETED')).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.paymentStatus).toBe('UNPAID');
  });

  it('refuses an idempotency key that belongs to someone else', async () => {
    const alice = await customerOwner('alice@example.com');
    const variant = await shoes();
    await addItem(alice, { variantId: variant.id, quantity: 1 });
    const input = checkoutInput();
    await placeOrder({ owner: alice, input });

    const bob = await customerOwner('bob@example.com');
    await addItem(bob, { variantId: variant.id, quantity: 1 });

    await expect(placeOrder({ owner: bob, input })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('does not let a guest key resolve to a signed-in customer’s order', async () => {
    const alice = await customerOwner('alice@example.com');
    const variant = await shoes();
    await addItem(alice, { variantId: variant.id, quantity: 1 });
    const input = checkoutInput();
    await placeOrder({ owner: alice, input });

    const guest = await guestOwner();
    await addItem(guest, { variantId: variant.id, quantity: 1 });

    await expect(placeOrder({ owner: guest, input })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('cancellation authorisation surface', () => {
  it('refuses to cancel from a status that does not allow it', async () => {
    const owner = await customerOwner('shopper@example.com');
    const { order } = await orderFor(owner);
    await transitionOrderStatus(order.id, 'CONFIRMED');
    await transitionOrderStatus(order.id, 'PROCESSING');
    await transitionOrderStatus(order.id, 'COMPLETED');

    await expect(cancelOrder(order.id)).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
  });

  it('reports a missing order as NOT_FOUND rather than crashing', async () => {
    await expect(cancelOrder(randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
