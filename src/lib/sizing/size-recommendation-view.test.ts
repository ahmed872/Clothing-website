import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@generated/prisma';

import { db } from '@/modules/core';
import { registerCustomer } from '@/modules/customers';
import { resetCustomerTables } from '@/modules/customers/testing';
import { saveBodyProfile } from '@/modules/body-profile';
import { resetBodyProfileTables } from '@/modules/body-profile/testing';
import { resetCatalogTables } from '@/modules/catalog/testing';
import { saveProductSizing } from '@/modules/sizing';
import { resetSizingTables } from '@/modules/sizing/testing';

/**
 * The product page's recommendation as a browser reaches it — the real
 * view, its route, the real database, only the customer session mocked.
 *
 * Its only inputs are a product id and a fit to try. There is no argument
 * that names a customer, so "customer A reads customer B's
 * recommendation" has nowhere to be attempted except the session; these
 * tests prove each caller gets an answer computed from their own profile
 * alone, and that the answer carries no measurement.
 */

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/identity/customer-auth', () => ({ customerAuth: authMock }));

const { getSizeRecommendationView } = await import('./size-recommendation-view');
const { GET } = await import('@/app/api/size-recommendation/route');

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

let counter = 0;
async function customer(chestCm: string | null) {
  counter += 1;
  const { user, customer: c } = await registerCustomer({
    email: `rec-${counter}-${Date.now()}@example.com`,
    password: 'correct-horse-9',
    name: 'Shopper',
  });
  if (chestCm !== null) {
    await saveBodyProfile(c.id, {
      gender: 'MALE',
      heightCm: '177',
      weightKg: '78',
      waistCm: '84',
      chestCm,
      shoulderCm: '45.3',
    });
  }
  return { userId: user.id, customerId: c.id };
}

async function tee(status: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED') {
  counter += 1;
  const category =
    (await db.category.findFirst({ where: { slug: 'rec-test' } })) ??
    (await db.category.create({ data: { slug: 'rec-test', nameAr: 'اختبار', nameEn: 'Test' } }));
  const product = await db.product.create({
    data: {
      slug: `rec-tee-${counter}`,
      nameAr: 'تيشيرت',
      nameEn: 'Tee',
      categoryId: category.id,
      status,
    },
  });
  const option = await db.productOption.create({
    data: {
      productId: product.id,
      nameAr: 'المقاس',
      nameEn: 'Size',
      values: {
        create: ['S', 'M', 'L', 'XL'].map((v, position) => ({ valueAr: v, valueEn: v, position })),
      },
    },
    include: { values: { orderBy: { position: 'asc' } } },
  });
  const chest = [101, 107, 113, 119];
  const shoulder = [42, 44, 46, 48];
  await saveProductSizing(product.id, {
    garmentType: 'T_SHIRT',
    sizeOptionId: option.id,
    entries: option.values.map((value, i) => ({
      optionValueId: value.id,
      measurements: { chestCm: String(chest[i]), shoulderCm: String(shoulder[i]) },
    })),
  });
  return { id: product.id, size: Object.fromEntries(option.values.map((v) => [v.valueEn, v.id])) };
}

beforeEach(async () => {
  await resetSizingTables();
  await resetBodyProfileTables();
  await resetCatalogTables();
  await resetCustomerTables();
  authMock.mockReset();
});

describe('who is asking', () => {
  it('signed out → an invitation, never a size', async () => {
    const product = await tee();
    signInAs(null);
    expect(await getSizeRecommendationView(product.id)).toEqual({ status: 'signed_out' });
  });

  it('a staff session is not a customer', async () => {
    const product = await tee();
    signInAs('00000000-0000-4000-8000-0000000000aa', 'OWNER');
    expect(await getSizeRecommendationView(product.id)).toEqual({ status: 'signed_out' });
  });

  it('signed in without a profile → no_profile', async () => {
    const product = await tee();
    const me = await customer(null);
    signInAs(me.userId);
    expect(await getSizeRecommendationView(product.id)).toEqual({ status: 'no_profile' });
  });
});

describe('each customer gets their own answer — and only theirs', () => {
  it('two customers, one product: each from their own profile', async () => {
    const product = await tee();
    const smaller = await customer('97');
    const larger = await customer('103');

    signInAs(smaller.userId);
    const a = await getSizeRecommendationView(product.id);
    signInAs(larger.userId);
    const b = await getSizeRecommendationView(product.id);

    expect(a).toMatchObject({ status: 'recommended', recommendedSizeId: product.size.M });
    expect(b).toMatchObject({ status: 'recommended', recommendedSizeId: product.size.L });
  });

  it('the answer carries no measurement — not the customer’s, not derivable', async () => {
    const product = await tee();
    const me = await customer('97.4');
    signInAs(me.userId);
    const view = await getSizeRecommendationView(product.id);
    const json = JSON.stringify(view);
    expect(json).not.toContain('97.4');
    expect(json).not.toContain('45.3');
    expect(json).not.toMatch(/customerId|userId|heightCm|weightKg/);
  });

  it('a fit to try changes the answer for this request only', async () => {
    const product = await tee();
    const me = await customer('97');
    signInAs(me.userId);
    const relaxed = await getSizeRecommendationView(product.id, 'RELAXED');
    expect(relaxed).toMatchObject({ fitPreference: 'RELAXED', recommendedSizeId: product.size.XL });
    const profile = await db.bodyProfile.findUniqueOrThrow({
      where: { customerId: me.customerId },
    });
    expect(profile.fitPreference).toBe('REGULAR');
  });

  it('a fit outside the closed list is ignored, not trusted', async () => {
    const product = await tee();
    const me = await customer('97');
    signInAs(me.userId);
    const view = await getSizeRecommendationView(product.id, 'SUPER_BAGGY');
    expect(view).toMatchObject({ status: 'recommended', fitPreference: 'REGULAR' });
  });
});

describe('the product side', () => {
  it('a malformed id, an unknown id, or a draft product → no_sizing', async () => {
    const me = await customer('97');
    signInAs(me.userId);
    expect(await getSizeRecommendationView('not-a-uuid')).toEqual({ status: 'no_sizing' });
    expect(await getSizeRecommendationView('5e0f3a4e-9999-4b8e-9c1f-999999999999')).toEqual({
      status: 'no_sizing',
    });
    const draft = await tee('DRAFT');
    expect(await getSizeRecommendationView(draft.id)).toEqual({ status: 'no_sizing' });
  });

  it('a missing measurement is named instead of guessed', async () => {
    const product = await tee();
    const me = await customer('97');
    await db.bodyProfile.update({ where: { customerId: me.customerId }, data: { chestCm: null } });
    signInAs(me.userId);
    expect(await getSizeRecommendationView(product.id)).toEqual({
      status: 'insufficient_data',
      garmentType: 'T_SHIRT',
      missing: ['chestCm'],
    });
  });

  it('outside the chart → no_matching_size, with the fit it aimed for', async () => {
    const product = await tee();
    const me = await customer('140');
    signInAs(me.userId);
    expect(await getSizeRecommendationView(product.id)).toEqual({
      status: 'no_matching_size',
      garmentType: 'T_SHIRT',
      fitPreference: 'REGULAR',
      direction: 'above',
    });
  });
});

describe('GET /api/size-recommendation', () => {
  const get = (query: string) =>
    GET(new Request(`http://127.0.0.1:3000/api/size-recommendation?${query}`));

  it('answers for the session’s customer, and is never cached', async () => {
    const product = await tee();
    const me = await customer('97');
    signInAs(me.userId);
    const response = await get(`productId=${product.id}&fit=SLIM`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(await response.json()).toMatchObject({
      status: 'recommended',
      fitPreference: 'SLIM',
      recommendedSizeId: product.size.M,
    });
  });

  it('a customer id in the query is not a parameter — the session decides', async () => {
    const product = await tee();
    const owner = await customer('97');
    const other = await customer(null);
    signInAs(other.userId);
    const response = await get(`productId=${product.id}&customerId=${owner.customerId}`);
    expect(await response.json()).toEqual({ status: 'no_profile' });
  });

  it('signed out, or no product id → no recommendation, no error page', async () => {
    signInAs(null);
    const product = await tee();
    expect(await (await get(`productId=${product.id}`)).json()).toEqual({ status: 'signed_out' });
    expect(await (await get('')).json()).toEqual({ status: 'no_sizing' });
  });
});
