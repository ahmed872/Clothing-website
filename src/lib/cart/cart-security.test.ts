import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@generated/prisma';

import { db } from '@/modules/core';
import { createCategory } from '@/modules/catalog/category.service';
import { createProduct, publishProduct } from '@/modules/catalog/product.service';
import { resetCatalogTables } from '@/modules/catalog/testing';
import { createCoupon } from '@/modules/pricing/coupon.service';
import { resetPricingTables } from '@/modules/pricing/testing';
import { resetCartTables } from '@/modules/cart/testing';

/**
 * P09's security matrix for the cart (§19, §27).
 *
 * The important structural point this file demonstrates: the cart actions
 * have no cart-id parameter and no price parameter, so the classic attacks
 * are not "blocked" here so much as unrepresentable. What is left to prove
 * is that identity is resolved from the session and the cookie, that two
 * shoppers cannot see each other, and that no amount of extra data in a
 * payload changes a total.
 */

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  // `updateTag` is what the admin actions call for read-your-own-writes
  // cache invalidation; a mock missing it fails as "not a function".
  updateTag: vi.fn(),
}));

// `cart-identity.ts` derives a signed-in shopper from the storefront's own
// customer session (`customerAuth`, a separate Auth.js instance from the
// admin `auth` — P12 §6), so that is the function this file mocks.
const authMock = vi.fn();
vi.mock('@/modules/identity/customer-auth', () => ({ customerAuth: authMock }));

/** A mutable stand-in for the request's cookie jar. */
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

const {
  addToCartAction,
  applyCouponAction,
  getCartAction,
  getCartCountAction,
  updateCartQuantityAction,
} = await import('./cart-actions');
const { CART_COOKIE_NAME } = await import('./cart-identity');

function signInAs(userId: string | null, role: Role = 'CUSTOMER'): void {
  authMock.mockResolvedValue(
    userId
      ? {
          user: { id: userId, email: `${userId}@example.com`, name: null, role },
          expires: '2099-01-01T00:00:00.000Z',
        }
      : null,
  );
}

function asGuest(token: string | null): void {
  signInAs(null);
  cookieJar.clear();
  if (token) cookieJar.set(CART_COOKIE_NAME, token);
}

beforeEach(async () => {
  await resetCartTables();
  await resetPricingTables();
  await resetCatalogTables();
  await db.customer.deleteMany();
  await db.user.deleteMany();
  authMock.mockReset();
  cookieJar.clear();
});

async function shoes(priceMinor = 45_000, stockQuantity = 10) {
  const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
  const product = await createProduct({
    product: { slug: 'runner', nameAr: 'حذاء', nameEn: 'Runner', categoryId: category.id },
    variants: [{ sku: 'RUN-1', priceMinor, stockQuantity }],
  });
  await publishProduct(product.id);
  return { product, variant: product.variants[0]! };
}

async function seedUser(id: string) {
  return db.user.create({
    data: { id, email: `${id}@example.com`, passwordHash: 'x', role: 'CUSTOMER' },
  });
}

const USER_A = '00000000-0000-4000-8000-0000000000aa';
const USER_B = '00000000-0000-4000-8000-0000000000bb';

describe('guest isolation', () => {
  it('a guest cart is reachable only with its own cookie', async () => {
    const { variant } = await shoes();

    asGuest(null);
    expect((await addToCartAction({ variantId: variant.id, quantity: 2 }, 'en')).ok).toBe(true);
    const token = cookieJar.get(CART_COOKIE_NAME)!;
    expect(token).toBeTruthy();
    expect(await getCartCountAction()).toBe(2);

    // A different guest, with a token of their own, sees nothing.
    asGuest('a-completely-different-token');
    expect(await getCartCountAction()).toBe(0);

    // And with the original token back, the cart is there again — the token
    // is the credential, and nothing else grants access.
    asGuest(token);
    expect(await getCartCountAction()).toBe(2);
  });

  it('a guessed token reaches nothing', async () => {
    const { variant } = await shoes();
    asGuest(null);
    await addToCartAction({ variantId: variant.id, quantity: 1 }, 'en');

    for (const guess of ['', 'cart', '1', 'null', 'undefined', '../../etc/passwd']) {
      asGuest(guess);
      expect(await getCartCountAction()).toBe(0);
    }
  });
});

describe('customer isolation', () => {
  it('two signed-in customers never see each other', async () => {
    const { variant } = await shoes();
    await seedUser(USER_A);
    await seedUser(USER_B);

    signInAs(USER_A);
    await addToCartAction({ variantId: variant.id, quantity: 3 }, 'en');
    expect(await getCartCountAction()).toBe(3);

    signInAs(USER_B);
    expect(await getCartCountAction()).toBe(0);

    // B changing their own cart leaves A's alone.
    await addToCartAction({ variantId: variant.id, quantity: 1 }, 'en');
    expect(await getCartCountAction()).toBe(1);

    signInAs(USER_A);
    expect(await getCartCountAction()).toBe(3);
  });

  it('a signed-in customer ignores a guest cookie pointing at another cart', async () => {
    const { variant } = await shoes();

    // A guest builds a cart.
    asGuest(null);
    await addToCartAction({ variantId: variant.id, quantity: 5 }, 'en');
    const guestToken = cookieJar.get(CART_COOKIE_NAME)!;

    // A customer signs in *carrying that cookie*. It is theirs — they were
    // the guest a moment ago — so it merges rather than being ignored, and
    // afterwards the token no longer refers to anything.
    await seedUser(USER_A);
    signInAs(USER_A);
    await addToCartAction({ variantId: variant.id, quantity: 1 }, 'en');
    expect(cookieJar.has(CART_COOKIE_NAME)).toBe(false);

    // The now-dead token grants a fresh, empty guest cart, not the merged one.
    asGuest(guestToken);
    expect(await getCartCountAction()).toBe(0);
  });
});

describe('the client cannot influence a price', () => {
  it('extra fields in the payload change nothing', async () => {
    const { variant } = await shoes(45_000);
    asGuest(null);

    // Exactly the shape an attacker would try. The action's signature has
    // no room for any of it, so it is dropped before it can be believed.
    const tampered = {
      variantId: variant.id,
      quantity: 1,
      unitPriceMinor: 1,
      priceMinor: 1,
      lineSubtotalMinor: 1,
      discountMinor: 44_999,
      totalMinor: 1,
      currency: 'XXX',
    } as unknown as { variantId: string; quantity: number };

    const result = await addToCartAction(tampered, 'en');
    expect(result.ok).toBe(true);
    expect(result.data?.subtotalMinor).toBe(45_000);
    expect(result.data?.totalMinor).toBe(45_000);
    expect(result.data?.discountMinor).toBe(0);
    expect(result.data?.currency).toBe('SAR');
  });

  it('a quantity beyond stock is refused, not honoured', async () => {
    const { variant } = await shoes(45_000, 2);
    asGuest(null);
    await addToCartAction({ variantId: variant.id, quantity: 1 }, 'en');

    const result = await updateCartQuantityAction({ variantId: variant.id, quantity: 99 }, 'en');
    expect(result.ok).toBe(false);
    expect(await getCartCountAction()).toBe(1);
  });

  it('a variant belonging to an unpublished product cannot be added', async () => {
    const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
    const draft = await createProduct({
      product: { slug: 'secret', nameAr: 'سري', nameEn: 'Secret', categoryId: category.id },
      variants: [{ sku: 'SECRET-1', priceMinor: 1_000, stockQuantity: 5 }],
    });

    asGuest(null);
    const result = await addToCartAction({ variantId: draft.variants[0]!.id, quantity: 1 }, 'en');
    expect(result.ok).toBe(false);
    expect(await getCartCountAction()).toBe(0);
  });

  it('an id that is not a variant is refused', async () => {
    const { product } = await shoes();
    asGuest(null);

    // A real id, of the wrong kind. Possession of an identifier is not
    // permission to use it as another one.
    expect((await addToCartAction({ variantId: product.id, quantity: 1 }, 'en')).ok).toBe(false);
    expect(
      (
        await addToCartAction(
          { variantId: '00000000-0000-4000-8000-000000000999', quantity: 1 },
          'en',
        )
      ).ok,
    ).toBe(false);
  });
});

describe('promotions cannot be forced', () => {
  it('an unknown code is refused and attaches nothing', async () => {
    const { variant } = await shoes();
    asGuest(null);
    await addToCartAction({ variantId: variant.id, quantity: 1 }, 'en');

    const result = await applyCouponAction('TOTALLY-MADE-UP', 'en');
    expect(result.ok).toBe(false);

    expect((await getCartAction('en')).data?.coupon).toBeNull();
  });

  it('an inactive code and a nonexistent one are indistinguishable', async () => {
    const { variant } = await shoes();
    await createCoupon({ code: 'PAUSED', type: 'PERCENTAGE', value: 50, active: false });

    asGuest(null);
    await addToCartAction({ variantId: variant.id, quantity: 1 }, 'en');

    const paused = await applyCouponAction('PAUSED', 'en');
    const missing = await applyCouponAction('NEVEREXISTED', 'en');

    expect(paused.ok).toBe(false);
    expect(missing.ok).toBe(false);
    // Same sentence: the coupon box must not become an oracle for guessing
    // which codes the store has.
    expect(paused.error).toBe(missing.error);
  });

  it('an expired code discounts nothing', async () => {
    const { variant } = await shoes(100_000);
    await createCoupon({
      code: 'LASTYEAR',
      type: 'PERCENTAGE',
      value: 50,
      endsAt: new Date('2020-01-01'),
    });

    asGuest(null);
    await addToCartAction({ variantId: variant.id, quantity: 1 }, 'en');
    const result = await applyCouponAction('LASTYEAR', 'en');

    expect(result.ok).toBe(false);
    expect((await getCartAction('en')).data?.discountMinor).toBe(0);
  });

  it('a code below its minimum is refused, and says what the minimum is', async () => {
    const { variant } = await shoes(10_000);
    await createCoupon({
      code: 'BIGSPEND',
      type: 'FIXED',
      value: 5_000,
      minOrderMinor: 100_000,
    });

    asGuest(null);
    await addToCartAction({ variantId: variant.id, quantity: 1 }, 'en');
    const result = await applyCouponAction('BIGSPEND', 'en');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/minimum/i);
  });

  it('a failed attempt does not knock off a promotion that was working', async () => {
    const { variant } = await shoes(100_000);
    await createCoupon({ code: 'GOOD10', type: 'PERCENTAGE', value: 10 });

    asGuest(null);
    await addToCartAction({ variantId: variant.id, quantity: 1 }, 'en');
    const applied = await applyCouponAction('GOOD10', 'en');
    expect(applied.data?.discountMinor).toBe(10_000);

    const failed = await applyCouponAction('NOPE', 'en');
    expect(failed.ok).toBe(false);

    const still = await getCartAction('en');
    expect(still.data?.coupon?.code).toBe('GOOD10');
    expect(still.data?.discountMinor).toBe(10_000);
  });

  it('a promotion stops discounting as soon as it is switched off', async () => {
    const { variant } = await shoes(100_000);
    const coupon = await createCoupon({ code: 'LIVE20', type: 'PERCENTAGE', value: 20 });

    asGuest(null);
    await addToCartAction({ variantId: variant.id, quantity: 1 }, 'en');
    expect((await applyCouponAction('LIVE20', 'en')).data?.discountMinor).toBe(20_000);

    await db.coupon.update({ where: { id: coupon.id }, data: { active: false } });

    // No cache to invalidate: the next read re-evaluates from live rows.
    const after = await getCartAction('en');
    expect(after.data?.discountMinor).toBe(0);
    expect(after.data?.coupon?.applied).toBe(false);
  });
});
