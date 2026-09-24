import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';

import { applyBulkPrice, previewBulkPrice } from './bulk-pricing.service';
import { createCategory } from './category.service';
import { createProduct } from './product.service';
import { resetCatalogTables } from './testing';

beforeEach(async () => {
  await resetCatalogTables();
});

/** One single-variant product per price, built through the real services so
 * these tests price the same rows the application produces. Separate
 * products on purpose: a bulk change spans a selection, not one product. */
async function priced(prices: number[], overrides: { compareAtMinor?: number } = {}) {
  const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
  const variantIds: string[] = [];
  for (const [index, priceMinor] of prices.entries()) {
    const product = await createProduct({
      product: {
        slug: `runner-${index + 1}`,
        nameAr: 'حذاء',
        nameEn: 'Runner',
        categoryId: category.id,
      },
      variants: [
        {
          sku: `RUN-${index + 1}`,
          priceMinor,
          compareAtMinor: overrides.compareAtMinor ?? null,
          stockQuantity: 5,
        },
      ],
    });
    variantIds.push(product.variants[0]!.id);
  }
  return { categoryId: category.id, variantIds };
}

describe('bulk price — absolute', () => {
  it('sets every selected variant to the same price', async () => {
    const { variantIds } = await priced([45000, 52000]);

    const result = await applyBulkPrice({
      variantIds,
      operation: { kind: 'absolute', priceMinor: 39900 },
    });

    expect(result.updated).toBe(2);
    const after = await db.variant.findMany({ where: { id: { in: variantIds } } });
    expect(after.map((variant) => variant.priceMinor)).toEqual([39900, 39900]);
  });

  it('touches nothing outside the selection', async () => {
    const { variantIds } = await priced([45000, 52000]);

    await applyBulkPrice({
      variantIds: [variantIds[0]!],
      operation: { kind: 'absolute', priceMinor: 100 },
    });

    const untouched = await db.variant.findUnique({ where: { id: variantIds[1]! } });
    expect(untouched?.priceMinor).toBe(52000);
  });
});

describe('bulk price — percentage', () => {
  it('raises and cuts by the given percentage', async () => {
    const { variantIds } = await priced([10000, 20000]);

    await applyBulkPrice({ variantIds, operation: { kind: 'percentage', percent: 10 } });
    let after = await db.variant.findMany({
      where: { id: { in: variantIds } },
      orderBy: { sku: 'asc' },
    });
    expect(after.map((variant) => variant.priceMinor)).toEqual([11000, 22000]);

    await applyBulkPrice({ variantIds, operation: { kind: 'percentage', percent: -50 } });
    after = await db.variant.findMany({
      where: { id: { in: variantIds } },
      orderBy: { sku: 'asc' },
    });
    expect(after.map((variant) => variant.priceMinor)).toEqual([5500, 11000]);
  });

  it('rounds to a whole minor unit rather than storing a fraction', async () => {
    // 1005 halalas + 5% = 1055.25 → 1055. A stored fraction would be a price
    // no currency can express.
    const { variantIds } = await priced([1005]);
    await applyBulkPrice({ variantIds, operation: { kind: 'percentage', percent: 5 } });
    const after = await db.variant.findUnique({ where: { id: variantIds[0]! } });
    expect(after?.priceMinor).toBe(1055);
    expect(Number.isInteger(after?.priceMinor)).toBe(true);
  });

  it('cannot drive a price below zero', async () => {
    const { variantIds } = await priced([100]);
    await applyBulkPrice({ variantIds, operation: { kind: 'percentage', percent: -99 } });
    const after = await db.variant.findUnique({ where: { id: variantIds[0]! } });
    expect(after?.priceMinor).toBe(1);
  });
});

describe('previewBulkPrice', () => {
  it('shows the new prices without writing them', async () => {
    const { variantIds } = await priced([10000, 20000]);

    const preview = await previewBulkPrice({
      variantIds,
      operation: { kind: 'percentage', percent: -10 },
    });

    expect(preview.rows.map((row) => [row.currentPriceMinor, row.newPriceMinor])).toEqual([
      [10000, 9000],
      [20000, 18000],
    ]);
    expect(preview.blockedCount).toBe(0);

    const after = await db.variant.findMany({ where: { id: { in: variantIds } } });
    expect(after.map((variant) => variant.priceMinor)).toEqual([10000, 20000]);
  });

  it('predicts exactly what apply writes', async () => {
    // The guarantee that makes a confirmation dialog honest: the admin
    // approves these numbers, so these numbers must be the ones that land.
    const { variantIds } = await priced([1005, 3333, 79999]);
    const operation = { kind: 'percentage', percent: 7.5 } as const;

    const preview = await previewBulkPrice({ variantIds, operation });
    const result = await applyBulkPrice({ variantIds, operation });

    const predicted = new Map(preview.rows.map((row) => [row.variantId, row.newPriceMinor]));
    const stored = await db.variant.findMany({ where: { id: { in: variantIds } } });
    for (const variant of stored) {
      expect(variant.priceMinor).toBe(predicted.get(variant.id));
    }
    expect(result.updated).toBe(3);
  });

  it('flags rows that would break a pricing invariant', async () => {
    // Compare-at must stay above the price; raising the price past it is
    // the mistake this preview is there to catch.
    const { variantIds } = await priced([10000], { compareAtMinor: 12000 });

    const preview = await previewBulkPrice({
      variantIds,
      operation: { kind: 'percentage', percent: 50 },
    });

    expect(preview.blockedCount).toBe(1);
    expect(preview.rows[0]!.problemReasonCode).toBe('compare_at_not_above_price');
  });
});

describe('applyBulkPrice — all or nothing', () => {
  it('refuses the whole batch when one row would break an invariant', async () => {
    const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
    const healthy = await createProduct({
      product: { slug: 'runner-1', nameAr: 'حذاء', nameEn: 'Runner', categoryId: category.id },
      variants: [{ sku: 'RUN-1', priceMinor: 10000, stockQuantity: 1 }],
    });
    const constrained = await createProduct({
      product: { slug: 'runner-2', nameAr: 'حذاء', nameEn: 'Runner', categoryId: category.id },
      variants: [{ sku: 'RUN-2', priceMinor: 10000, compareAtMinor: 12000, stockQuantity: 1 }],
    });
    const variantIds = [healthy.variants[0]!.id, constrained.variants[0]!.id];

    await expect(
      applyBulkPrice({ variantIds, operation: { kind: 'percentage', percent: 50 } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    // The healthy row is left alone too — a half-applied price change across
    // a category is indistinguishable from a deliberate one.
    const after = await db.variant.findMany({ where: { id: { in: variantIds } } });
    expect(after.every((variant) => variant.priceMinor === 10000)).toBe(true);
  });

  it('refuses a selection containing an id that does not exist', async () => {
    const { variantIds } = await priced([10000]);

    await expect(
      applyBulkPrice({
        variantIds: [...variantIds, '00000000-0000-4000-8000-000000000000'],
        operation: { kind: 'absolute', priceMinor: 500 },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const after = await db.variant.findUnique({ where: { id: variantIds[0]! } });
    expect(after?.priceMinor).toBe(10000);
  });
});

describe('bulk price — input validation', () => {
  it('rejects an empty selection', async () => {
    await expect(
      applyBulkPrice({ variantIds: [], operation: { kind: 'absolute', priceMinor: 100 } }),
    ).rejects.toThrow();
  });

  it('rejects a negative absolute price', async () => {
    const { variantIds } = await priced([10000]);
    await expect(
      applyBulkPrice({ variantIds, operation: { kind: 'absolute', priceMinor: -1 } }),
    ).rejects.toThrow();
  });

  it('rejects a cut of 100% or more', async () => {
    const { variantIds } = await priced([10000]);
    await expect(
      applyBulkPrice({ variantIds, operation: { kind: 'percentage', percent: -100 } }),
    ).rejects.toThrow();
  });
});
