import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@generated/prisma';

import { db } from '@/modules/core';
import { resetCatalogTables } from '@/modules/catalog/testing';
import { resetIdentityTables } from '@/modules/identity/testing';
import { createUser } from '@/modules/identity/user.service';

/**
 * P08's Security Test Matrix (§11–§14), exercised against the server
 * actions themselves, called directly the way a crafted request would call
 * them — never through the UI. A hidden button proves nothing.
 *
 * Rows covered:
 *   1. Permission matrix — every inventory and pricing action, every role,
 *      plus a signed-out caller.
 *   2. Direct unauthorized invocation — the action is called anyway, and the
 *      database is checked afterwards to prove the number did not move.
 *   3. IDOR — a product id where a variant id belongs, an id that exists as
 *      another entity, an adjustment's own id, an id that exists nowhere.
 *   4. Audit — a refusal writes no success entry; an allowed call names the
 *      real actor and records no secret.
 */

// `revalidatePath` needs Next's request store, which does not exist in a
// plain Node test process; cache invalidation is not what is under test.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  // `updateTag` is what the admin actions call for read-your-own-writes
  // cache invalidation; a mock missing it fails as "not a function".
  updateTag: vi.fn(),
}));

const authMock = vi.fn();
vi.mock('@/modules/identity/auth', () => ({ auth: authMock }));

const { adjustStockAction, setInventoryPolicyAction } = await import('./inventory-actions');
const { updateVariantPriceAction, previewBulkPriceAction, applyBulkPriceAction } =
  await import('./pricing-actions');

const ACTOR_ID = '00000000-0000-4000-8000-00000000ffff';
const MISSING_ID = '00000000-0000-4000-8000-000000000123';

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

async function seedVariant(slug = 'runner', stockQuantity = 10) {
  const category = await db.category.upsert({
    where: { slug: 'shoes' },
    update: {},
    create: { slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' },
  });
  const product = await db.product.create({
    data: { slug, nameAr: 'حذاء', nameEn: 'Runner', categoryId: category.id, status: 'DRAFT' },
  });
  const variant = await db.variant.create({
    data: {
      productId: product.id,
      sku: `${slug}-sku`.toUpperCase(),
      priceMinor: 100000,
      stockQuantity,
    },
  });
  return { product, variant };
}

beforeEach(async () => {
  await resetCatalogTables();
  await resetIdentityTables();
  authMock.mockReset();
});

// ---------------------------------------------------------------------------
// 1. Permission matrix
// ---------------------------------------------------------------------------

describe('P08 Security Matrix — 1. Permission matrix per role', () => {
  const ROLES: Role[] = ['OWNER', 'MANAGER', 'STAFF', 'CUSTOMER'];

  /** Written out literally rather than derived from `ROLE_PERMISSIONS`, so
   * a change to the role table has to be made deliberately in two places
   * instead of silently agreeing with itself.
   *
   * The split that matters: STAFF counts stock but cannot reprice. */
  const MATRIX: { name: string; allowed: Role[]; run: () => Promise<{ ok: boolean }> }[] = [
    {
      name: 'adjustStockAction',
      allowed: ['OWNER', 'MANAGER', 'STAFF'],
      run: async () => {
        const { variant } = await seedVariant(`adj-${Math.random().toString(36).slice(2, 8)}`);
        return adjustStockAction(variant.id, { delta: 1, reason: 'RESTOCK' }, 'en');
      },
    },
    {
      name: 'setInventoryPolicyAction',
      allowed: ['OWNER', 'MANAGER', 'STAFF'],
      run: async () => {
        const { variant } = await seedVariant(`pol-${Math.random().toString(36).slice(2, 8)}`);
        return setInventoryPolicyAction(variant.id, { lowStockThreshold: 4 }, null, 'en');
      },
    },
    {
      name: 'updateVariantPriceAction',
      allowed: ['OWNER', 'MANAGER'],
      run: async () => {
        const { variant } = await seedVariant(`prc-${Math.random().toString(36).slice(2, 8)}`);
        return updateVariantPriceAction(
          variant.id,
          { priceMinor: 90000, compareAtMinor: null },
          null,
          'en',
        );
      },
    },
    {
      name: 'previewBulkPriceAction',
      allowed: ['OWNER', 'MANAGER'],
      run: async () => {
        const { variant } = await seedVariant(`pvw-${Math.random().toString(36).slice(2, 8)}`);
        return previewBulkPriceAction([variant.id], { kind: 'percentage', percent: -10 }, 'en');
      },
    },
    {
      name: 'applyBulkPriceAction',
      allowed: ['OWNER', 'MANAGER'],
      run: async () => {
        const { variant } = await seedVariant(`blk-${Math.random().toString(36).slice(2, 8)}`);
        return applyBulkPriceAction([variant.id], { kind: 'percentage', percent: -10 }, 'en');
      },
    },
  ];

  for (const entry of MATRIX) {
    for (const role of ROLES) {
      const expected = entry.allowed.includes(role);
      it(`${entry.name}: ${role} is ${expected ? 'allowed' : 'refused'}`, async () => {
        await seedActor(role);
        signInAs(role);
        expect((await entry.run()).ok).toBe(expected);
      });
    }

    it(`${entry.name}: a signed-out caller is refused`, async () => {
      signInAs(null);
      expect((await entry.run()).ok).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Direct unauthorized invocation
// ---------------------------------------------------------------------------

describe('P08 Security Matrix — 2. A refused action moves no number', () => {
  it('a refused stock adjustment leaves the quantity and the history untouched', async () => {
    const { variant } = await seedVariant('refused-stock', 7);
    await seedActor('CUSTOMER');
    signInAs('CUSTOMER');

    expect((await adjustStockAction(variant.id, { delta: 500, reason: 'RESTOCK' }, 'en')).ok).toBe(
      false,
    );

    const after = await db.variant.findUnique({ where: { id: variant.id } });
    expect(after?.stockQuantity).toBe(7);
    expect(await db.inventoryAdjustment.count()).toBe(0);
  });

  it('STAFF cannot reprice, single or bulk', async () => {
    const { variant } = await seedVariant('staff-price');
    await seedActor('STAFF');
    signInAs('STAFF');

    expect(
      (
        await updateVariantPriceAction(
          variant.id,
          { priceMinor: 1, compareAtMinor: null },
          null,
          'en',
        )
      ).ok,
    ).toBe(false);
    expect(
      (await applyBulkPriceAction([variant.id], { kind: 'absolute', priceMinor: 1 }, 'en')).ok,
    ).toBe(false);

    const after = await db.variant.findUnique({ where: { id: variant.id } });
    expect(after?.priceMinor).toBe(100000);
  });

  it('a signed-out caller cannot even preview a bulk change', async () => {
    const { variant } = await seedVariant('anon-preview');
    signInAs(null);

    const result = await previewBulkPriceAction(
      [variant.id],
      { kind: 'percentage', percent: -50 },
      'en',
    );
    expect(result.ok).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it('a refused bulk price writes nothing, not even the rows it could have', async () => {
    const a = await seedVariant('bulk-a');
    const b = await seedVariant('bulk-b');
    await seedActor('STAFF');
    signInAs('STAFF');

    expect(
      (
        await applyBulkPriceAction(
          [a.variant.id, b.variant.id],
          { kind: 'absolute', priceMinor: 1 },
          'en',
        )
      ).ok,
    ).toBe(false);

    const after = await db.variant.findMany({ where: { priceMinor: 1 } });
    expect(after).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. IDOR
// ---------------------------------------------------------------------------

describe('P08 Security Matrix — 3. IDOR', () => {
  it('a product id handed to a stock action adjusts nothing', async () => {
    const { product, variant } = await seedVariant('idor-product', 10);
    await seedActor('OWNER');
    signInAs('OWNER');

    // The product row genuinely exists — possession of a real id is not
    // authorization to use it as a variant id.
    expect((await adjustStockAction(product.id, { delta: 5, reason: 'RESTOCK' }, 'en')).ok).toBe(
      false,
    );
    expect((await db.variant.findUnique({ where: { id: variant.id } }))?.stockQuantity).toBe(10);
    expect(await db.inventoryAdjustment.count()).toBe(0);
  });

  it('an adjustment record id is not a variant id', async () => {
    const { variant } = await seedVariant('idor-adjustment', 10);
    await seedActor('OWNER');
    signInAs('OWNER');
    expect((await adjustStockAction(variant.id, { delta: 5, reason: 'RESTOCK' }, 'en')).ok).toBe(
      true,
    );
    const adjustment = await db.inventoryAdjustment.findFirstOrThrow();

    expect(
      (await adjustStockAction(adjustment.id, { delta: 100, reason: 'RESTOCK' }, 'en')).ok,
    ).toBe(false);
    expect((await db.variant.findUnique({ where: { id: variant.id } }))?.stockQuantity).toBe(15);
  });

  it('an id that exists nowhere is refused by every write', async () => {
    await seedActor('OWNER');
    signInAs('OWNER');

    expect((await adjustStockAction(MISSING_ID, { delta: 1, reason: 'MANUAL' }, 'en')).ok).toBe(
      false,
    );
    expect(
      (await setInventoryPolicyAction(MISSING_ID, { lowStockThreshold: 1 }, null, 'en')).ok,
    ).toBe(false);
    expect(
      (
        await updateVariantPriceAction(
          MISSING_ID,
          { priceMinor: 1, compareAtMinor: null },
          null,
          'en',
        )
      ).ok,
    ).toBe(false);
  });

  it('one unknown id in a bulk selection refuses the whole batch', async () => {
    const { variant } = await seedVariant('bulk-idor');
    await seedActor('OWNER');
    signInAs('OWNER');

    const result = await applyBulkPriceAction(
      [variant.id, MISSING_ID],
      { kind: 'absolute', priceMinor: 500 },
      'en',
    );
    expect(result.ok).toBe(false);

    // The real variant in the same selection is untouched: a partly applied
    // price change is worse than none, and an attacker padding a selection
    // with a guessed id must not get a partial write out of it.
    expect((await db.variant.findUnique({ where: { id: variant.id } }))?.priceMinor).toBe(100000);
  });
});

// ---------------------------------------------------------------------------
// 4. Audit
// ---------------------------------------------------------------------------

describe('P08 Security Matrix — 4. Audit', () => {
  it('a refused adjustment writes no success audit entry', async () => {
    const { variant } = await seedVariant('audit-refused');
    await seedActor('CUSTOMER');
    signInAs('CUSTOMER');

    await adjustStockAction(variant.id, { delta: 1, reason: 'RESTOCK' }, 'en');
    expect(await db.auditLog.count({ where: { action: 'inventory.adjusted' } })).toBe(0);
  });

  it('an allowed adjustment records the actor, the movement and the reason', async () => {
    const { variant } = await seedVariant('audit-allowed', 4);
    await seedActor('STAFF');
    signInAs('STAFF');

    expect(
      (
        await adjustStockAction(
          variant.id,
          { delta: 6, reason: 'RESTOCK', note: 'Received from supplier' },
          'en',
        )
      ).ok,
    ).toBe(true);

    const entry = await db.auditLog.findFirstOrThrow({ where: { action: 'inventory.adjusted' } });
    expect(entry.userId).toBe(ACTOR_ID);
    expect(entry.entityId).toBe(variant.id);
    expect(entry.entityType).toBe('Variant');
    expect(entry.before).toMatchObject({ stockQuantity: 4 });
    expect(entry.after).toMatchObject({ stockQuantity: 10, delta: 6, reason: 'RESTOCK' });
  });

  it('a price change records what it became', async () => {
    const { variant } = await seedVariant('audit-price');
    await seedActor('MANAGER');
    signInAs('MANAGER');

    await updateVariantPriceAction(
      variant.id,
      { priceMinor: 88000, compareAtMinor: null },
      null,
      'en',
    );
    const entry = await db.auditLog.findFirstOrThrow({ where: { action: 'price.updated' } });
    expect(entry.after).toMatchObject({ priceMinor: 88000 });
  });

  it('a bulk change is auditable per variant, not as one anonymous batch', async () => {
    const a = await seedVariant('audit-bulk-a');
    const b = await seedVariant('audit-bulk-b');
    await seedActor('MANAGER');
    signInAs('MANAGER');

    await applyBulkPriceAction(
      [a.variant.id, b.variant.id],
      { kind: 'percentage', percent: -10 },
      'en',
    );

    const entries = await db.auditLog.findMany({ where: { action: 'price.bulk_updated' } });
    expect(entries).toHaveLength(2);
    // Each entry files itself under the variant it changed, so "what
    // happened to this SKU" stays answerable by filtering the log.
    expect(new Set(entries.map((entry) => entry.entityId))).toEqual(
      new Set([a.variant.id, b.variant.id]),
    );
    expect(entries[0]!.after).toMatchObject({ priceMinor: 90000 });
  });

  it('no audit snapshot carries a password, hash, token or secret', async () => {
    const { variant } = await seedVariant('audit-no-leak');
    await seedActor('OWNER');
    signInAs('OWNER');

    await adjustStockAction(variant.id, { delta: 2, reason: 'MANUAL', note: 'shelf count' }, 'en');
    await setInventoryPolicyAction(variant.id, { lowStockThreshold: 3 }, null, 'en');
    await applyBulkPriceAction([variant.id], { kind: 'percentage', percent: -5 }, 'en');

    const entries = await db.auditLog.findMany();
    expect(entries.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(entries).toLowerCase();
    for (const forbidden of ['password', 'passwordhash', 'token', 'secret', 'session', '$2b$']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Concurrency, through the action layer
// ---------------------------------------------------------------------------

describe('P08 Security Matrix — 5. Concurrency', () => {
  it('two admins adjusting the same variant at once both land', async () => {
    const { variant } = await seedVariant('concurrent-stock', 10);
    await seedActor('MANAGER');
    signInAs('MANAGER');

    const results = await Promise.all([
      adjustStockAction(variant.id, { delta: 5, reason: 'RESTOCK' }, 'en'),
      adjustStockAction(variant.id, { delta: 3, reason: 'RETURN' }, 'en'),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);

    // 10 + 5 + 3. A read-compute-write would land on 15 or 13 here, and
    // whichever admin lost would never be told.
    expect((await db.variant.findUnique({ where: { id: variant.id } }))?.stockQuantity).toBe(18);
    expect(await db.inventoryAdjustment.count()).toBe(2);
  });

  it('a second policy save from a stale page is refused, not silently applied', async () => {
    const { variant } = await seedVariant('concurrent-policy');
    await seedActor('MANAGER');
    signInAs('MANAGER');
    const loadedAt = variant.updatedAt.toISOString();

    expect(
      (await setInventoryPolicyAction(variant.id, { lowStockThreshold: 2 }, loadedAt, 'en')).ok,
    ).toBe(true);
    expect(
      (await setInventoryPolicyAction(variant.id, { lowStockThreshold: 9 }, loadedAt, 'en')).ok,
    ).toBe(false);

    expect((await db.variant.findUnique({ where: { id: variant.id } }))?.lowStockThreshold).toBe(2);
  });

  it('a second price save from a stale page is refused', async () => {
    const { variant } = await seedVariant('concurrent-price');
    await seedActor('MANAGER');
    signInAs('MANAGER');
    const loadedAt = variant.updatedAt.toISOString();

    expect(
      (
        await updateVariantPriceAction(
          variant.id,
          { priceMinor: 90000, compareAtMinor: null },
          loadedAt,
          'en',
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await updateVariantPriceAction(
          variant.id,
          { priceMinor: 50000, compareAtMinor: null },
          loadedAt,
          'en',
        )
      ).ok,
    ).toBe(false);

    expect((await db.variant.findUnique({ where: { id: variant.id } }))?.priceMinor).toBe(90000);
  });
});
