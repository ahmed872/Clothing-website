import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';
import { createCategory } from '@/modules/catalog/category.service';
import { createProduct } from '@/modules/catalog/product.service';
import { resetCatalogTables } from '@/modules/catalog/testing';
import type { CreateProductInput } from '@/modules/catalog/schemas';

import { adjustStock, listAdjustments, setInventoryPolicy } from './inventory.service';

beforeEach(async () => {
  await resetCatalogTables();
});

/** A one-variant product to move stock on. Built through the real catalog
 * services rather than raw inserts, so these tests exercise the same rows
 * the application actually produces. */
async function variantFixture(overrides: { stockQuantity?: number; sku?: string } = {}) {
  const category = await createCategory({
    slug: `shoes-${(overrides.sku ?? 'a').toLowerCase()}`,
    nameAr: 'أحذية',
    nameEn: 'Shoes',
  });
  const input: CreateProductInput = {
    product: {
      slug: `runner-${(overrides.sku ?? 'a').toLowerCase()}`,
      nameAr: 'حذاء',
      nameEn: 'Runner',
      categoryId: category.id,
    },
    variants: [
      {
        sku: overrides.sku ?? 'RUN-1',
        priceMinor: 45000,
        stockQuantity: overrides.stockQuantity ?? 10,
      },
    ],
  };
  const product = await createProduct(input);
  return { product, variant: product.variants[0]! };
}

describe('adjustStock — movements', () => {
  it('adds stock and records what happened', async () => {
    const { variant } = await variantFixture({ stockQuantity: 10 });

    const { adjustment, variant: after } = await adjustStock({
      variantId: variant.id,
      delta: 10,
      reason: 'RESTOCK',
      note: 'Received from supplier',
    });

    expect(after.stockQuantity).toBe(20);
    expect(adjustment).toMatchObject({
      delta: 10,
      previousQuantity: 10,
      newQuantity: 20,
      reason: 'RESTOCK',
      note: 'Received from supplier',
    });
  });

  it('removes stock', async () => {
    const { variant } = await variantFixture({ stockQuantity: 10 });
    const { variant: after } = await adjustStock({
      variantId: variant.id,
      delta: -2,
      reason: 'DAMAGED',
    });
    expect(after.stockQuantity).toBe(8);
  });

  it('sets an exact quantity, recording the delta it implies', async () => {
    const { variant } = await variantFixture({ stockQuantity: 10 });

    const { adjustment, variant: after } = await adjustStock({
      variantId: variant.id,
      setTo: 3,
      reason: 'CORRECTION',
      note: 'Counted the shelf',
    });

    expect(after.stockQuantity).toBe(3);
    expect(adjustment).toMatchObject({ delta: -7, previousQuantity: 10, newQuantity: 3 });
  });

  it('records the actor when one is given', async () => {
    const { variant } = await variantFixture();
    const user = await db.user.create({
      data: { email: 'stock@example.com', passwordHash: 'x', role: 'STAFF' },
    });

    const { adjustment } = await adjustStock({
      variantId: variant.id,
      delta: 1,
      reason: 'MANUAL',
      actorUserId: user.id,
    });

    expect(adjustment.actorUserId).toBe(user.id);
    await db.inventoryAdjustment.deleteMany();
    await db.user.delete({ where: { id: user.id } });
  });
});

describe('adjustStock — refusals leave nothing behind', () => {
  it('refuses to take stock negative', async () => {
    const { variant } = await variantFixture({ stockQuantity: 3 });

    await expect(
      adjustStock({ variantId: variant.id, delta: -5, reason: 'DAMAGED' }),
    ).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });

    const after = await db.variant.findUnique({ where: { id: variant.id } });
    expect(after?.stockQuantity).toBe(3);
    // The whole transaction rolled back: no history entry for a move that
    // never happened.
    expect(await db.inventoryAdjustment.count()).toBe(0);
  });

  it('refuses a no-op adjustment rather than writing an empty history row', async () => {
    const { variant } = await variantFixture({ stockQuantity: 5 });

    await expect(
      adjustStock({ variantId: variant.id, setTo: 5, reason: 'CORRECTION' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await db.inventoryAdjustment.count()).toBe(0);
  });

  it('rejects a zero delta before it reaches the database', async () => {
    const { variant } = await variantFixture();
    await expect(
      adjustStock({ variantId: variant.id, delta: 0, reason: 'MANUAL' }),
    ).rejects.toThrow();
  });

  it('rejects giving both a delta and an exact quantity', async () => {
    const { variant } = await variantFixture();
    await expect(
      adjustStock({ variantId: variant.id, delta: 1, setTo: 5, reason: 'MANUAL' }),
    ).rejects.toThrow();
  });

  it('rejects a variant that does not exist', async () => {
    await expect(
      adjustStock({
        variantId: '00000000-0000-4000-8000-000000000000',
        delta: 1,
        reason: 'MANUAL',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('adjustStock — concurrency', () => {
  it('two simultaneous adjustments both land; neither is lost', async () => {
    const { variant } = await variantFixture({ stockQuantity: 10 });

    // Issued together, so they genuinely overlap: the row lock inside the
    // transaction is what makes the second one read the first one's result
    // instead of the stale 10 they both started from. A naive
    // read-compute-write would finish at 15 here.
    await Promise.all([
      adjustStock({ variantId: variant.id, delta: 5, reason: 'RESTOCK' }),
      adjustStock({ variantId: variant.id, delta: 5, reason: 'RESTOCK' }),
    ]);

    const after = await db.variant.findUnique({ where: { id: variant.id } });
    expect(after?.stockQuantity).toBe(20);

    const history = await db.inventoryAdjustment.findMany({
      where: { variantId: variant.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history).toHaveLength(2);
    // Each entry describes a real transition, and together they chain:
    // 10→15 and 15→20, in whichever order the lock granted them.
    const sorted = [...history].sort((a, b) => a.previousQuantity - b.previousQuantity);
    expect(sorted.map((h) => [h.previousQuantity, h.newQuantity])).toEqual([
      [10, 15],
      [15, 20],
    ]);
  });

  it('concurrent removals cannot drive stock below zero', async () => {
    const { variant } = await variantFixture({ stockQuantity: 5 });

    const results = await Promise.allSettled([
      adjustStock({ variantId: variant.id, delta: -3, reason: 'DAMAGED' }),
      adjustStock({ variantId: variant.id, delta: -3, reason: 'DAMAGED' }),
    ]);

    // One succeeds, the other is refused — never a silent -1.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

    const after = await db.variant.findUnique({ where: { id: variant.id } });
    expect(after?.stockQuantity).toBe(2);
    expect(await db.inventoryAdjustment.count()).toBe(1);
  });

  it('adjustments to different variants do not block each other', async () => {
    const a = await variantFixture({ stockQuantity: 1, sku: 'A' });
    const b = await variantFixture({ stockQuantity: 1, sku: 'B' });

    await Promise.all([
      adjustStock({ variantId: a.variant.id, delta: 4, reason: 'RESTOCK' }),
      adjustStock({ variantId: b.variant.id, delta: 9, reason: 'RESTOCK' }),
    ]);

    expect((await db.variant.findUnique({ where: { id: a.variant.id } }))?.stockQuantity).toBe(5);
    expect((await db.variant.findUnique({ where: { id: b.variant.id } }))?.stockQuantity).toBe(10);
  });
});

describe('setInventoryPolicy', () => {
  it('changes tracking and the low-stock threshold', async () => {
    const { variant } = await variantFixture();

    const after = await setInventoryPolicy(variant.id, {
      trackInventory: false,
      lowStockThreshold: 4,
    });

    expect(after.trackInventory).toBe(false);
    expect(after.lowStockThreshold).toBe(4);
  });

  it('writes no adjustment row — policy is not a movement', async () => {
    const { variant } = await variantFixture();
    await setInventoryPolicy(variant.id, { lowStockThreshold: 2 });
    expect(await db.inventoryAdjustment.count()).toBe(0);
  });

  it('refuses a stale save from a second editor', async () => {
    const { variant } = await variantFixture();
    const loadedAt = variant.updatedAt;

    await setInventoryPolicy(variant.id, { lowStockThreshold: 2 }, loadedAt);
    await expect(
      setInventoryPolicy(variant.id, { lowStockThreshold: 9 }, loadedAt),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const after = await db.variant.findUnique({ where: { id: variant.id } });
    expect(after?.lowStockThreshold).toBe(2);
  });

  it('rejects a negative threshold', async () => {
    const { variant } = await variantFixture();
    await expect(setInventoryPolicy(variant.id, { lowStockThreshold: -1 })).rejects.toThrow();
  });
});

describe('listAdjustments', () => {
  it('returns newest first, paginated in the database', async () => {
    const { variant } = await variantFixture({ stockQuantity: 0 });
    for (let i = 0; i < 5; i += 1) {
      await adjustStock({ variantId: variant.id, delta: 1, reason: 'RESTOCK' });
    }

    const firstPage = await listAdjustments({ pageSize: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.total).toBe(5);
    expect(firstPage.pageCount).toBe(3);
    expect(firstPage.items[0]!.newQuantity).toBe(5);

    const lastPage = await listAdjustments({ pageSize: 2, page: 3 });
    expect(lastPage.items).toHaveLength(1);
    expect(lastPage.items[0]!.newQuantity).toBe(1);
  });

  it('filters by variant, product, reason and date range', async () => {
    const a = await variantFixture({ stockQuantity: 10, sku: 'A' });
    const b = await variantFixture({ stockQuantity: 10, sku: 'B' });

    await adjustStock({ variantId: a.variant.id, delta: 1, reason: 'RESTOCK' });
    await adjustStock({ variantId: a.variant.id, delta: -1, reason: 'DAMAGED' });
    await adjustStock({ variantId: b.variant.id, delta: 2, reason: 'RESTOCK' });

    expect((await listAdjustments({ variantId: a.variant.id })).total).toBe(2);
    expect((await listAdjustments({ productId: b.product.id })).total).toBe(1);
    expect((await listAdjustments({ reason: 'DAMAGED' })).total).toBe(1);

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect((await listAdjustments({ from: tomorrow })).total).toBe(0);
    expect((await listAdjustments({ to: tomorrow })).total).toBe(3);
  });

  it('carries the product and variant a row is about', async () => {
    const { variant, product } = await variantFixture({ sku: 'LOOKUP' });
    await adjustStock({ variantId: variant.id, delta: 1, reason: 'MANUAL' });

    const [entry] = (await listAdjustments({ variantId: variant.id })).items;
    expect(entry?.variant.sku).toBe('LOOKUP');
    expect(entry?.product.id).toBe(product.id);
    expect(entry?.actor).toBeNull();
  });
});
