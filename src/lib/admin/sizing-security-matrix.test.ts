import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@generated/prisma';

import { db } from '@/modules/core';
import { resetCatalogTables } from '@/modules/catalog/testing';
import { resetIdentityTables } from '@/modules/identity/testing';
import { createUser } from '@/modules/identity/user.service';
import { resetSizingTables } from '@/modules/sizing/testing';

/**
 * Clothing P02 — the size chart actions, called directly as a crafted
 * request would call them, with the database checked afterwards.
 *
 *   1. Permission matrix — only roles holding `products.update` may save or
 *      remove a chart; everyone else is refused and nothing changes.
 *   2. IDOR — a size option or size belonging to another product is refused
 *      even for an OWNER, and the chart is left as it was.
 *   3. Validation — malformed input comes back as per-cell codes, unsaved.
 *   4. Concurrency — a save against an outdated version is refused.
 *   5. Audit — an allowed change names the real actor.
 */

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

const authMock = vi.fn();
vi.mock('@/modules/identity/auth', () => ({ auth: authMock }));

const { saveProductSizingAction, deleteProductSizingAction } = await import('./sizing-actions');

const ACTOR_ID = '00000000-0000-4000-8000-00000000fff2';

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
    email: `${role.toLowerCase()}-sizing@example.com`,
    password: 'matrix-pass-123',
    role,
  });
  await db.user.update({ where: { id: user.id }, data: { id: ACTOR_ID } });
}

let counter = 0;
async function seedProduct() {
  counter += 1;
  const category =
    (await db.category.findFirst({ where: { slug: 'sizing-matrix' } })) ??
    (await db.category.create({
      data: { slug: 'sizing-matrix', nameAr: 'مقاسات', nameEn: 'Sizing' },
    }));
  const product = await db.product.create({
    data: {
      slug: `matrix-tee-${counter}`,
      nameAr: 'تيشيرت',
      nameEn: 'Tee',
      categoryId: category.id,
    },
  });
  const option = await db.productOption.create({
    data: {
      productId: product.id,
      nameAr: 'المقاس',
      nameEn: 'Size',
      values: {
        create: [
          { valueAr: 'S', valueEn: 'S' },
          { valueAr: 'M', valueEn: 'M', position: 1 },
        ],
      },
    },
    include: { values: { orderBy: { position: 'asc' } } },
  });
  return { productId: product.id, optionId: option.id, sizes: option.values.map((v) => v.id) };
}

function chart(p: Awaited<ReturnType<typeof seedProduct>>) {
  return {
    garmentType: 'T_SHIRT' as const,
    sizeOptionId: p.optionId,
    entries: p.sizes.map((optionValueId, i) => ({
      optionValueId,
      measurements: { chestCm: String(100 + i * 6) },
    })),
  };
}

beforeEach(async () => {
  await resetSizingTables();
  await resetCatalogTables();
  await resetIdentityTables();
  authMock.mockReset();
});

describe('permission matrix', () => {
  it.each([
    ['OWNER', true],
    ['MANAGER', true],
    ['STAFF', false],
    ['CUSTOMER', false],
  ] as const)('%s may save a size chart: %s', async (role, allowed) => {
    await seedActor(role);
    signInAs(role);
    const p = await seedProduct();
    const result = await saveProductSizingAction(p.productId, chart(p), null, 'en');
    expect(result.ok).toBe(allowed);
    expect(await db.productSizing.count()).toBe(allowed ? 1 : 0);
  });

  it('signed out: refused, nothing written', async () => {
    signInAs(null);
    const p = await seedProduct();
    expect((await saveProductSizingAction(p.productId, chart(p), null, 'en')).ok).toBe(false);
    expect((await deleteProductSizingAction(p.productId, 'en')).ok).toBe(false);
    expect(await db.productSizing.count()).toBe(0);
  });

  it('STAFF cannot remove a chart', async () => {
    await seedActor('OWNER');
    signInAs('OWNER');
    const p = await seedProduct();
    await saveProductSizingAction(p.productId, chart(p), null, 'en');
    await seedActor('STAFF');
    signInAs('STAFF');
    expect((await deleteProductSizingAction(p.productId, 'en')).ok).toBe(false);
    expect(await db.productSizing.count()).toBe(1);
  });
});

describe('IDOR — ids belonging to another product', () => {
  it("refuses another product's size option and sizes, even for an owner", async () => {
    await seedActor('OWNER');
    signInAs('OWNER');
    const mine = await seedProduct();
    const theirs = await seedProduct();

    const foreignOption = await saveProductSizingAction(
      mine.productId,
      { ...chart(theirs) },
      null,
      'en',
    );
    expect(foreignOption).toMatchObject({ ok: false });
    expect(foreignOption.error).toMatch(/does not belong to this product/);

    const foreignSize = await saveProductSizingAction(
      mine.productId,
      {
        ...chart(mine),
        entries: [{ optionValueId: theirs.sizes[0]!, measurements: { chestCm: '100' } }],
      },
      null,
      'en',
    );
    expect(foreignSize.ok).toBe(false);
    expect(await db.productSizing.count()).toBe(0);
    expect(await db.sizeChartEntry.count()).toBe(0);
  });
});

describe('validation, concurrency and audit', () => {
  it('malformed input comes back as per-cell codes, and nothing is saved', async () => {
    await seedActor('OWNER');
    signInAs('OWNER');
    const p = await seedProduct();
    const result = await saveProductSizingAction(
      p.productId,
      {
        ...chart(p),
        entries: [
          { optionValueId: p.sizes[0]!, measurements: { chestCm: '-1' } },
          { optionValueId: p.sizes[0]!, measurements: { chestCm: '9999' } },
        ],
      },
      null,
      'en',
    );
    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.entries).toEqual({
      0: { chestCm: 'invalid_number' },
      1: { optionValueId: 'duplicate_size', chestCm: 'invalid_number' },
    });
    expect(await db.productSizing.count()).toBe(0);
  });

  it('a save from an outdated editor is refused', async () => {
    await seedActor('OWNER');
    signInAs('OWNER');
    const p = await seedProduct();
    const first = await saveProductSizingAction(p.productId, chart(p), null, 'en');
    const version = first.sizing!.updatedAt;
    expect((await saveProductSizingAction(p.productId, chart(p), version, 'en')).ok).toBe(true);
    const stale = await saveProductSizingAction(p.productId, chart(p), version, 'en');
    expect(stale.ok).toBe(false);
    expect(stale.error).toMatch(/reload/);
    expect((await saveProductSizingAction(p.productId, chart(p), 'garbage', 'en')).ok).toBe(false);
  });

  it('an allowed change is audited under the real actor', async () => {
    await seedActor('MANAGER');
    signInAs('MANAGER');
    const p = await seedProduct();
    await saveProductSizingAction(p.productId, chart(p), null, 'en');
    await deleteProductSizingAction(p.productId, 'en');
    const events = await db.auditLog.findMany({
      where: { entityId: p.productId, action: 'product.updated' },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => [e.userId, e.after])).toEqual([
      [ACTOR_ID, { sizingSaved: 'T_SHIRT', sizes: ['S', 'M'] }],
      [ACTOR_ID, { sizingRemoved: true }],
    ]);
  });
});
