import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@generated/prisma';

import { db } from '@/modules/core';
import { resetIdentityTables } from '@/modules/identity/testing';
import { createUser } from '@/modules/identity/user.service';
import { createCoupon } from '@/modules/pricing/coupon.service';
import { resetPricingTables } from '@/modules/pricing/testing';

/**
 * P09's authorization matrix for promotion management (§19, §27), exercised
 * against the server actions themselves — never through the UI. A hidden
 * menu item proves nothing; these prove the server refuses.
 */

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  // `updateTag` is what the admin actions call for read-your-own-writes
  // cache invalidation; a mock missing it fails as "not a function".
  updateTag: vi.fn(),
}));

const authMock = vi.fn();
vi.mock('@/modules/identity/auth', () => ({ auth: authMock }));

const {
  createPromotionAction,
  updatePromotionAction,
  setPromotionActiveAction,
  deletePromotionAction,
} = await import('./promotion-actions');
const { searchProductsForScopeAction, listScopeTargetsAction } =
  await import('./scope-search-actions');

const ACTOR_ID = '00000000-0000-4000-8000-00000000ffff';

function signInAs(role: Role | null): void {
  authMock.mockResolvedValue(
    role
      ? {
          user: { id: ACTOR_ID, email: `${role.toLowerCase()}@example.com`, name: null, role },
          expires: '2099-01-01T00:00:00.000Z',
        }
      : null,
  );
}

async function seedActor(role: Role): Promise<void> {
  await db.user.deleteMany({ where: { id: ACTOR_ID } });
  const user = await createUser({
    email: `${role.toLowerCase()}@example.com`,
    password: 'matrix-pass-123',
    role,
  });
  await db.user.update({ where: { id: user.id }, data: { id: ACTOR_ID } });
}

function form(overrides: Record<string, unknown> = {}) {
  return {
    code: `CODE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    type: 'PERCENTAGE' as const,
    value: 10,
    descriptionAr: null,
    descriptionEn: null,
    minOrderMinor: null,
    maxDiscountMinor: null,
    usageLimit: null,
    perCustomerLimit: null,
    startsAt: null,
    endsAt: null,
    active: true,
    scopes: [],
    ...overrides,
  };
}

beforeEach(async () => {
  await resetPricingTables();
  await resetIdentityTables();
  authMock.mockReset();
});

describe('permission matrix', () => {
  const ROLES: Role[] = ['OWNER', 'MANAGER', 'STAFF', 'CUSTOMER'];

  /** Written out literally rather than derived from `ROLE_PERMISSIONS`, so a
   * change to the role table has to be made deliberately in two places. */
  const ALLOWED: Role[] = ['OWNER', 'MANAGER'];

  for (const role of ROLES) {
    const expected = ALLOWED.includes(role);

    it(`createPromotionAction: ${role} is ${expected ? 'allowed' : 'refused'}`, async () => {
      await seedActor(role);
      signInAs(role);
      expect((await createPromotionAction(form(), 'en')).ok).toBe(expected);
    });

    it(`setPromotionActiveAction: ${role} is ${expected ? 'allowed' : 'refused'}`, async () => {
      const coupon = await createCoupon({ code: 'TOGGLE', type: 'FIXED', value: 500 });
      await seedActor(role);
      signInAs(role);
      expect((await setPromotionActiveAction(coupon.id, false, 'en')).ok).toBe(expected);
    });

    it(`deletePromotionAction: ${role} is ${expected ? 'allowed' : 'refused'}`, async () => {
      const coupon = await createCoupon({ code: 'GONE', type: 'FIXED', value: 500 });
      await seedActor(role);
      signInAs(role);
      expect((await deletePromotionAction(coupon.id, 'en')).ok).toBe(expected);
    });
  }

  it('a signed-out caller is refused everything', async () => {
    const coupon = await createCoupon({ code: 'ANON', type: 'FIXED', value: 500 });
    signInAs(null);

    expect((await createPromotionAction(form(), 'en')).ok).toBe(false);
    expect((await setPromotionActiveAction(coupon.id, false, 'en')).ok).toBe(false);
    expect((await deletePromotionAction(coupon.id, 'en')).ok).toBe(false);
    expect((await updatePromotionAction(coupon.id, form(), null, 'en')).ok).toBe(false);
  });

  it('the scope search is gated too — it reads the catalog', async () => {
    signInAs(null);
    await expect(searchProductsForScopeAction('run', 'en')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(listScopeTargetsAction('en')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    await seedActor('STAFF');
    signInAs('STAFF');
    await expect(searchProductsForScopeAction('run', 'en')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('a refused action changes nothing', () => {
  it('STAFF cannot create, pause or delete a promotion', async () => {
    const coupon = await createCoupon({
      code: 'UNTOUCHED',
      type: 'PERCENTAGE',
      value: 25,
      active: true,
    });
    await seedActor('STAFF');
    signInAs('STAFF');

    await createPromotionAction(form({ code: 'SNEAKY' }), 'en');
    await setPromotionActiveAction(coupon.id, false, 'en');
    await deletePromotionAction(coupon.id, 'en');

    expect(await db.coupon.count({ where: { code: 'SNEAKY' } })).toBe(0);
    const after = await db.coupon.findUnique({ where: { id: coupon.id } });
    expect(after?.active).toBe(true);
    expect(after?.value).toBe(25);
  });

  it('a refused action writes no success audit entry', async () => {
    await seedActor('STAFF');
    signInAs('STAFF');
    await createPromotionAction(form(), 'en');
    expect(await db.auditLog.count({ where: { action: 'promotion.created' } })).toBe(0);
  });
});

describe('audit', () => {
  it('records the actor and the rule that was created', async () => {
    await seedActor('MANAGER');
    signInAs('MANAGER');

    const result = await createPromotionAction(
      form({ code: 'AUDITME', type: 'PERCENTAGE', value: 15, usageLimit: 100 }),
      'en',
    );
    expect(result.ok).toBe(true);

    const entry = await db.auditLog.findFirstOrThrow({ where: { action: 'promotion.created' } });
    expect(entry.userId).toBe(ACTOR_ID);
    expect(entry.entityType).toBe('Coupon');
    expect(entry.entityId).toBe(result.data!.id);
    expect(entry.after).toMatchObject({ code: 'AUDITME', value: 15, usageLimit: 100 });
  });

  it('distinguishes activation from deactivation', async () => {
    const coupon = await createCoupon({ code: 'SWITCH', type: 'FIXED', value: 500 });
    await seedActor('OWNER');
    signInAs('OWNER');

    await setPromotionActiveAction(coupon.id, false, 'en');
    await setPromotionActiveAction(coupon.id, true, 'en');

    expect(await db.auditLog.count({ where: { action: 'promotion.deactivated' } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'promotion.activated' } })).toBe(1);
  });

  it('records an edit against the promotion it changed', async () => {
    const coupon = await createCoupon({ code: 'EDITME', type: 'PERCENTAGE', value: 10 });
    await seedActor('MANAGER');
    signInAs('MANAGER');

    const result = await updatePromotionAction(
      coupon.id,
      form({ code: 'EDITME', value: 30 }),
      coupon.updatedAt.toISOString(),
      'en',
    );
    expect(result.ok).toBe(true);

    const entry = await db.auditLog.findFirstOrThrow({ where: { action: 'promotion.updated' } });
    expect(entry.entityId).toBe(coupon.id);
    expect(entry.after).toMatchObject({ value: 30 });
  });

  it('no audit snapshot carries a password, hash, token or secret', async () => {
    await seedActor('OWNER');
    signInAs('OWNER');
    await createPromotionAction(form({ code: 'CLEAN' }), 'en');

    const entries = await db.auditLog.findMany();
    const serialized = JSON.stringify(entries).toLowerCase();
    for (const forbidden of ['password', 'passwordhash', 'token', 'secret', '$2b$']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe('server-side validation is not optional', () => {
  beforeEach(async () => {
    await seedActor('OWNER');
    signInAs('OWNER');
  });

  it('refuses a percentage above 100 however it is submitted', async () => {
    expect((await createPromotionAction(form({ value: 500 }), 'en')).ok).toBe(false);
    expect(await db.coupon.count()).toBe(0);
  });

  it('refuses a backwards validity window', async () => {
    const result = await createPromotionAction(
      form({ startsAt: '2026-12-01', endsAt: '2026-01-01' }),
      'en',
    );
    expect(result.ok).toBe(false);
  });

  it('refuses a duplicate code with a message naming the problem', async () => {
    await createCoupon({ code: 'TAKEN', type: 'FIXED', value: 100 });
    const result = await createPromotionAction(form({ code: 'taken' }), 'en');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already in use/i);
  });

  it('refuses a stale edit from a second admin', async () => {
    const coupon = await createCoupon({ code: 'RACE', type: 'FIXED', value: 100 });
    const loadedAt = coupon.updatedAt.toISOString();

    // FIXED, so 200 and 300 are amounts in minor units rather than
    // percentages — a percentage above 100 is refused by a different rule.
    const edit = (value: number) => form({ code: 'RACE', type: 'FIXED' as const, value });

    expect((await updatePromotionAction(coupon.id, edit(200), loadedAt, 'en')).ok).toBe(true);
    expect((await updatePromotionAction(coupon.id, edit(300), loadedAt, 'en')).ok).toBe(false);

    expect((await db.coupon.findUnique({ where: { id: coupon.id } }))?.value).toBe(200);
  });

  it('refuses deleting a promotion that has been redeemed', async () => {
    const coupon = await createCoupon({ code: 'USED', type: 'FIXED', value: 100 });
    const user = await db.user.create({
      data: { email: 'shopper@example.com', passwordHash: 'x', role: 'CUSTOMER' },
    });
    const customer = await db.customer.create({ data: { userId: user.id } });
    const order = await db.order.create({
      data: {
        number: 'ORD-SEC-1',
        customerId: customer.id,
        status: 'PENDING_PAYMENT',
        subtotalMinor: 1_000,
        totalMinor: 1_000,
      },
    });
    await db.couponRedemption.create({
      data: { couponId: coupon.id, customerId: customer.id, orderId: order.id },
    });

    const result = await deletePromotionAction(coupon.id, 'en');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/pause it instead/i);
    expect(await db.coupon.count({ where: { id: coupon.id } })).toBe(1);

    await db.couponRedemption.deleteMany();
    await db.order.deleteMany();
    await db.customer.deleteMany();
  });
});
