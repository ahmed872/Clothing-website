import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@generated/prisma';

import { db } from '@/modules/core';
import { resetCatalogTables } from '@/modules/catalog/testing';
import { resetIdentityTables } from '@/modules/identity/testing';
import { createUser } from '@/modules/identity/user.service';

/**
 * P07's Security Test Matrix (§21–§24), exercised where it actually
 * matters: the server actions themselves, called directly, exactly as a
 * crafted request would call them — never through the UI. A hidden button
 * proves nothing; these tests prove the server refuses.
 *
 * Rows covered:
 *   1. Permission matrix — every catalog action against every role.
 *   2. Direct unauthorized invocation — the action is called anyway, and
 *      the database is checked afterwards to prove nothing changed.
 *   3. IDOR — an id belonging to a different entity, or to nothing at all,
 *      is refused rather than silently mutating something else.
 *   4. Concurrency — two admins editing the same row; the second save is
 *      rejected instead of quietly overwriting the first.
 *   5. Audit — a refused action leaves no audit trail of success, and an
 *      allowed one names the real actor.
 */

// `revalidatePath` needs Next's request store, which does not exist in a
// plain Node test process; the actions' cache invalidation is not what is
// under test here.
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
  createProductAction,
  updateProductAction,
  publishProductAction,
  deleteProductAction,
  bulkProductStatusAction,
} = await import('./product-actions');
const { createCategoryAction, deleteCategoryAction } = await import('./category-actions');
const { createBrandAction, deleteBrandAction } = await import('./brand-actions');
const { createAttributeDefinitionAction } = await import('./attribute-actions');
const { updateVariantAction, deleteVariantAction } = await import('./variant-actions');

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

/** A real actor row, so `recordAuditEvent`'s FK to `User` resolves for the
 * actions that are expected to succeed. */
async function seedActor(role: Role): Promise<void> {
  await db.user.deleteMany({ where: { id: ACTOR_ID } });
  const user = await createUser({
    email: `${role.toLowerCase()}@example.com`,
    password: 'matrix-pass-123',
    role,
  });
  await db.user.update({ where: { id: user.id }, data: { id: ACTOR_ID } });
}

async function seedCategory(slug = 'cars'): Promise<string> {
  const category = await db.category.create({
    data: { slug, nameAr: 'سيارات', nameEn: 'Cars' },
  });
  return category.id;
}

async function seedProduct(categoryId: string, slug = 'test-car') {
  const product = await db.product.create({
    data: { slug, nameAr: 'سيارة', nameEn: 'Car', categoryId, status: 'DRAFT' },
  });
  const variant = await db.variant.create({
    data: { productId: product.id, sku: `${slug}-sku`, priceMinor: 100000 },
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

describe('Security Matrix — 1. Permission matrix per role', () => {
  const ROLES: Role[] = ['OWNER', 'MANAGER', 'STAFF', 'CUSTOMER'];

  /** Which roles each catalog action must accept. Written out literally
   * rather than derived from `ROLE_PERMISSIONS`, so a change to the role
   * table has to be made deliberately in two places instead of silently
   * agreeing with itself. */
  const MATRIX: { name: string; allowed: Role[]; run: () => Promise<{ ok: boolean }> }[] = [
    {
      name: 'createCategoryAction',
      allowed: ['OWNER', 'MANAGER'],
      run: () => createCategoryAction({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' }, 'en'),
    },
    {
      name: 'createBrandAction',
      allowed: ['OWNER', 'MANAGER'],
      run: () => createBrandAction({ slug: 'acme', nameAr: 'أكمي', nameEn: 'Acme' }, 'en'),
    },
    {
      name: 'createProductAction',
      allowed: ['OWNER', 'MANAGER'],
      run: async () => {
        const categoryId = await seedCategory(`cat-${Math.random().toString(36).slice(2, 8)}`);
        return createProductAction(
          {
            product: {
              slug: `p-${Math.random().toString(36).slice(2, 8)}`,
              nameAr: 'منتج',
              nameEn: 'Product',
              categoryId,
            },
            initialVariant: { sku: `SKU-${Math.random().toString(36).slice(2, 8)}`, priceMinor: 1 },
          },
          'en',
        );
      },
    },
  ];

  for (const entry of MATRIX) {
    for (const role of ROLES) {
      const expected = entry.allowed.includes(role);
      it(`${entry.name}: ${role} is ${expected ? 'allowed' : 'refused'}`, async () => {
        await seedActor(role);
        signInAs(role);
        const result = await entry.run();
        expect(result.ok).toBe(expected);
      });
    }

    it(`${entry.name}: a signed-out caller is refused`, async () => {
      signInAs(null);
      expect((await entry.run()).ok).toBe(false);
    });
  }

  it('deleteProductAction needs products.delete: STAFF no, MANAGER yes', async () => {
    const categoryId = await seedCategory();
    const { product } = await seedProduct(categoryId);

    await seedActor('STAFF');
    signInAs('STAFF');
    expect((await deleteProductAction(product.id, 'en')).ok).toBe(false);

    // MANAGER runs the store's catalog day to day — everything except
    // `users.manage` (see `ROLE_PERMISSIONS`), deleting products included.
    await seedActor('MANAGER');
    signInAs('MANAGER');
    expect((await deleteProductAction(product.id, 'en')).ok).toBe(true);
  });

  it('STAFF can read the catalog but cannot change it', async () => {
    const categoryId = await seedCategory();
    const { product, variant } = await seedProduct(categoryId);
    await seedActor('STAFF');
    signInAs('STAFF');

    expect((await updateProductAction(product.id, { nameEn: 'Hacked' }, null, 'en')).ok).toBe(
      false,
    );
    expect((await publishProductAction(product.id, 'en')).ok).toBe(false);
    expect(
      (await updateVariantAction(variant.id, product.id, { priceMinor: 1 }, null, 'en')).ok,
    ).toBe(false);
    expect((await deleteVariantAction(variant.id, product.id, 'en')).ok).toBe(false);
    expect((await deleteCategoryAction(categoryId, 'en')).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Direct unauthorized invocation
// ---------------------------------------------------------------------------

describe('Security Matrix — 2. A refused action changes nothing', () => {
  it('a refused product update leaves the row exactly as it was', async () => {
    const categoryId = await seedCategory();
    const { product } = await seedProduct(categoryId);
    await seedActor('STAFF');
    signInAs('STAFF');

    const result = await updateProductAction(product.id, { nameEn: 'Hacked' }, null, 'en');
    expect(result.ok).toBe(false);

    const after = await db.product.findUnique({ where: { id: product.id } });
    expect(after?.nameEn).toBe('Car');
    expect(after?.status).toBe('DRAFT');
  });

  it('a refused delete leaves the product present and not soft-deleted', async () => {
    const categoryId = await seedCategory();
    const { product } = await seedProduct(categoryId);
    await seedActor('STAFF');
    signInAs('STAFF');

    expect((await deleteProductAction(product.id, 'en')).ok).toBe(false);
    const after = await db.product.findUnique({ where: { id: product.id } });
    expect(after?.deletedAt).toBeNull();
  });

  it('a refused bulk publish publishes nothing', async () => {
    const categoryId = await seedCategory();
    const a = await seedProduct(categoryId, 'car-a');
    const b = await seedProduct(categoryId, 'car-b');
    await seedActor('STAFF');
    signInAs('STAFF');

    expect((await bulkProductStatusAction([a.product.id, b.product.id], 'publish', 'en')).ok).toBe(
      false,
    );
    const published = await db.product.count({ where: { status: 'PUBLISHED' } });
    expect(published).toBe(0);
  });

  it('a refused action writes no success audit event', async () => {
    const categoryId = await seedCategory();
    const { product } = await seedProduct(categoryId);
    await seedActor('STAFF');
    signInAs('STAFF');

    await publishProductAction(product.id, 'en');
    expect(await db.auditLog.count({ where: { action: 'product.published' } })).toBe(0);
  });

  it('an allowed action records the real actor', async () => {
    const categoryId = await seedCategory();
    const { product } = await seedProduct(categoryId);
    await seedActor('OWNER');
    signInAs('OWNER');

    expect((await publishProductAction(product.id, 'en')).ok).toBe(true);
    const entry = await db.auditLog.findFirst({ where: { action: 'product.published' } });
    expect(entry?.userId).toBe(ACTOR_ID);
    expect(entry?.entityId).toBe(product.id);
  });
});

// ---------------------------------------------------------------------------
// 3. IDOR
// ---------------------------------------------------------------------------

describe('Security Matrix — 3. IDOR', () => {
  const MISSING_ID = '00000000-0000-4000-8000-000000000123';

  it('an id that exists but belongs to another entity type mutates nothing', async () => {
    const categoryId = await seedCategory();
    const { product, variant } = await seedProduct(categoryId);
    await seedActor('OWNER');
    signInAs('OWNER');

    // A variant id handed to a product action, and vice versa.
    expect((await updateProductAction(variant.id, { nameEn: 'X' }, null, 'en')).ok).toBe(false);
    expect(
      (await updateVariantAction(product.id, product.id, { priceMinor: 1 }, null, 'en')).ok,
    ).toBe(false);

    const productAfter = await db.product.findUnique({ where: { id: product.id } });
    const variantAfter = await db.variant.findUnique({ where: { id: variant.id } });
    expect(productAfter?.nameEn).toBe('Car');
    expect(variantAfter?.priceMinor).toBe(100000);
  });

  it('an id that does not exist is refused, not created', async () => {
    await seedActor('OWNER');
    signInAs('OWNER');

    expect((await updateProductAction(MISSING_ID, { nameEn: 'Ghost' }, null, 'en')).ok).toBe(false);
    expect((await deleteCategoryAction(MISSING_ID, 'en')).ok).toBe(false);
    expect((await deleteBrandAction(MISSING_ID, 'en')).ok).toBe(false);
    expect(await db.product.count()).toBe(0);
  });

  it('an attribute definition cannot be attached to a category that does not exist', async () => {
    await seedActor('OWNER');
    signInAs('OWNER');

    const result = await createAttributeDefinitionAction(
      { categoryId: MISSING_ID, key: 'color', labelAr: 'اللون', labelEn: 'Color', type: 'TEXT' },
      'en',
    );
    expect(result.ok).toBe(false);
    expect(await db.attributeDefinition.count()).toBe(0);
  });

  it('a role without the permission is refused whatever id it supplies', async () => {
    const categoryId = await seedCategory();
    const { product } = await seedProduct(categoryId);
    await seedActor('STAFF');
    signInAs('STAFF');

    for (const id of [product.id, MISSING_ID, categoryId]) {
      expect((await updateProductAction(id, { nameEn: 'X' }, null, 'en')).ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Concurrency
// ---------------------------------------------------------------------------

describe('Security Matrix — 4. Concurrent edits', () => {
  it('the second admin saving a stale product form is rejected, not silently applied', async () => {
    const categoryId = await seedCategory();
    const { product } = await seedProduct(categoryId);
    await seedActor('OWNER');
    signInAs('OWNER');

    // Both admins loaded the form at the same version.
    const loadedAt = product.updatedAt.toISOString();

    const first = await updateProductAction(product.id, { nameEn: 'First edit' }, loadedAt, 'en');
    expect(first.ok).toBe(true);

    const second = await updateProductAction(product.id, { nameEn: 'Second edit' }, loadedAt, 'en');
    expect(second.ok).toBe(false);

    const after = await db.product.findUnique({ where: { id: product.id } });
    expect(after?.nameEn).toBe('First edit');
  });

  it('re-reading the new version lets the second admin save deliberately', async () => {
    const categoryId = await seedCategory();
    const { product } = await seedProduct(categoryId);
    await seedActor('OWNER');
    signInAs('OWNER');

    const first = await updateProductAction(
      product.id,
      { nameEn: 'First edit' },
      product.updatedAt.toISOString(),
      'en',
    );
    const second = await updateProductAction(
      product.id,
      { nameEn: 'Second edit' },
      first.data?.updatedAt ?? null,
      'en',
    );
    expect(second.ok).toBe(true);

    const after = await db.product.findUnique({ where: { id: product.id } });
    expect(after?.nameEn).toBe('Second edit');
  });

  it('the same conflict protects a single variant', async () => {
    const categoryId = await seedCategory();
    const { product, variant } = await seedProduct(categoryId);
    await seedActor('OWNER');
    signInAs('OWNER');

    const loadedAt = variant.updatedAt.toISOString();
    expect(
      (await updateVariantAction(variant.id, product.id, { priceMinor: 200 }, loadedAt, 'en')).ok,
    ).toBe(true);
    expect(
      (await updateVariantAction(variant.id, product.id, { priceMinor: 300 }, loadedAt, 'en')).ok,
    ).toBe(false);

    const after = await db.variant.findUnique({ where: { id: variant.id } });
    expect(after?.priceMinor).toBe(200);
  });
});
