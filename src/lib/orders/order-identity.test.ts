import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@generated/prisma';

import { db } from '@/modules/core';
import { createCategory } from '@/modules/catalog/category.service';
import { createProduct, publishProduct } from '@/modules/catalog/product.service';
import { resetCatalogTables } from '@/modules/catalog/testing';
import { resetPricingTables } from '@/modules/pricing/testing';
import { addItem, newGuestToken } from '@/modules/cart';
import { resetCartTables } from '@/modules/cart/testing';
import { resetOrderTables } from '@/modules/orders/testing';

/**
 * `resolveOrderAccess` (P12 §14/§16) — the composition point rewired to the
 * real customer session (`getOptionalCustomerAccount`) instead of the P10
 * placeholder. Two guarantees matter here, both stated in the file's own
 * doc comment and both worth proving directly rather than trusting the
 * comment: a customer session never opens an order that belongs to someone
 * else, and a guest's access-token cookie keeps working even after that
 * guest signs in (the "checked out as a guest, then created an account"
 * path) — the fallback must not have been accidentally short-circuited by
 * the new session-based branch running first.
 */

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  // `updateTag` is what the admin actions call for read-your-own-writes
  // cache invalidation; a mock missing it fails as "not a function".
  updateTag: vi.fn(),
}));

const customerAuthMock = vi.fn();
vi.mock('@/modules/identity/customer-auth', () => ({ customerAuth: customerAuthMock }));

const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined,
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
}));

// Dynamic, not static: `order.service.ts` and `order-identity.ts` both
// transitively import `@/modules/identity` (for audit events and the
// customer session respectively), and a static import is hoisted above the
// `customerAuthMock` declaration above, which would make the mock factory
// run before that `const` is initialized. Deferring to a dynamic import
// here — after the mock is registered and the variable assigned — is the
// same fix `cart-security.test.ts`/`authorize.test.ts` already use.
const { placeOrder } = await import('@/modules/orders/order.service');
const { resolveOrderAccess, rememberGuestOrder, guestTokenFor, ORDER_ACCESS_COOKIE_NAME } =
  await import('./order-identity');

function signInAs(userId: string | null, role: Role = 'CUSTOMER'): void {
  customerAuthMock.mockResolvedValue(
    userId
      ? {
          user: { id: userId, email: `${userId}@example.com`, name: null, role },
          expires: '2099-01-01T00:00:00.000Z',
        }
      : null,
  );
}

beforeEach(async () => {
  await resetOrderTables();
  await resetCartTables();
  await resetPricingTables();
  await resetCatalogTables();
  await db.customer.deleteMany();
  await db.user.deleteMany();
  customerAuthMock.mockReset();
  cookieJar.clear();
});

let fixtureCounter = 0;
async function shoes() {
  fixtureCounter += 1;
  const suffix = fixtureCounter;
  const category = await createCategory({
    slug: `shoes-${suffix}`,
    nameAr: 'أحذية',
    nameEn: 'Shoes',
  });
  const product = await createProduct({
    product: {
      slug: `runner-${suffix}`,
      nameAr: 'حذاء',
      nameEn: 'Runner',
      categoryId: category.id,
    },
    variants: [{ sku: `RUN-${suffix}`, priceMinor: 45_000, stockQuantity: 10 }],
  });
  await publishProduct(product.id);
  return product.variants[0]!;
}

async function customerOwner(userId: string) {
  const user = await db.user.create({
    data: { id: userId, email: `${userId}@example.com`, passwordHash: 'x', role: 'CUSTOMER' },
  });
  const customer = await db.customer.create({ data: { userId: user.id } });
  return { customerId: customer.id, guestToken: null, userId: user.id };
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

async function orderFor(owner: { customerId: string | null; guestToken: string | null }) {
  const variant = await shoes();
  await addItem(owner, { variantId: variant.id, quantity: 1 });
  return placeOrder({ owner, input: checkoutInput() });
}

const ALICE = '00000000-0000-4000-8000-0000000000a1';
const BOB = '00000000-0000-4000-8000-0000000000b1';

describe('resolveOrderAccess — customer branch', () => {
  it('grants a signed-in customer access to their own order', async () => {
    const alice = await customerOwner(ALICE);
    const { order } = await orderFor(alice);

    signInAs(alice.userId);
    const access = await resolveOrderAccess(order.number);
    expect(access).toMatchObject({ via: 'customer', order: { number: order.number } });
  });

  it("never grants a signed-in customer access to another customer's order by number", async () => {
    const alice = await customerOwner(ALICE);
    const bob = await customerOwner(BOB);
    const { order } = await orderFor(alice);

    signInAs(bob.userId);
    expect(await resolveOrderAccess(order.number)).toBeNull();
  });

  it('an invented order number and a real-but-foreign one are indistinguishable', async () => {
    const alice = await customerOwner(ALICE);
    const bob = await customerOwner(BOB);
    const { order } = await orderFor(alice);

    signInAs(bob.userId);
    const forForeignOrder = await resolveOrderAccess(order.number);
    const forInventedOrder = await resolveOrderAccess('LD-000000-ZZZZZZ');
    expect(forForeignOrder).toBeNull();
    expect(forInventedOrder).toBeNull();
  });
});

describe('resolveOrderAccess — guest-token branch', () => {
  it('grants access to a guest holding the right access-token cookie', async () => {
    const guestToken = newGuestToken();
    const { order, accessToken } = await orderFor({ customerId: null, guestToken });

    signInAs(null);
    await rememberGuestOrder(order.number, accessToken!);
    const access = await resolveOrderAccess(order.number);
    expect(access).toMatchObject({ via: 'guest-token', order: { number: order.number } });
  });

  it('denies access with no cookie at all', async () => {
    const guestToken = newGuestToken();
    const { order } = await orderFor({ customerId: null, guestToken });

    signInAs(null);
    expect(await resolveOrderAccess(order.number)).toBeNull();
  });

  it('denies access with a wrong or guessed token', async () => {
    const guestToken = newGuestToken();
    const { order } = await orderFor({ customerId: null, guestToken });

    signInAs(null);
    await rememberGuestOrder(order.number, 'a-completely-guessed-token');
    expect(await resolveOrderAccess(order.number)).toBeNull();
  });

  it('falls through to the guest-token cookie for a signed-in customer who checked out as a guest earlier', async () => {
    const guestToken = newGuestToken();
    const { order, accessToken } = await orderFor({ customerId: null, guestToken });

    // They created an account after the fact — no Customer row owns this
    // order, but they still hold the cookie from checkout.
    const alice = await customerOwner(ALICE);
    void alice;
    signInAs(ALICE);
    await rememberGuestOrder(order.number, accessToken!);

    const access = await resolveOrderAccess(order.number);
    expect(access).toMatchObject({ via: 'guest-token', order: { number: order.number } });
  });

  it('a signed-in customer’s own guest-cookie access to someone else’s guest order still fails', async () => {
    const guestToken = newGuestToken();
    const { order } = await orderFor({ customerId: null, guestToken });

    const alice = await customerOwner(ALICE);
    signInAs(alice.userId);
    // No cookie remembered for this order at all — only a valid customer
    // session for an unrelated account.
    expect(await resolveOrderAccess(order.number)).toBeNull();
  });
});

describe('rememberGuestOrder / guestTokenFor', () => {
  it('round-trips a remembered token for its own order number', async () => {
    signInAs(null);
    await rememberGuestOrder('LD-TEST-000001', 'token-one');
    expect(await guestTokenFor('LD-TEST-000001')).toBe('token-one');
    expect(await guestTokenFor('LD-TEST-000002')).toBeNull();
  });

  it('caps the remembered list so the cookie cannot grow without bound', async () => {
    signInAs(null);
    for (let i = 0; i < 8; i += 1) {
      await rememberGuestOrder(`LD-TEST-00000${i}`, `token-${i}`);
    }
    const store = cookieJar.get(ORDER_ACCESS_COOKIE_NAME)!;
    const remembered = JSON.parse(store) as unknown[];
    expect(remembered.length).toBeLessThanOrEqual(5);
    // The most recent entries survive; the oldest are evicted.
    expect(await guestTokenFor('LD-TEST-000007')).toBe('token-7');
    expect(await guestTokenFor('LD-TEST-000000')).toBeNull();
  });
});
