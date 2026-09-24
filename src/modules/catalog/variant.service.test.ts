import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';

import { createCategory } from './category.service';
import { createProduct, publishProduct } from './product.service';
import {
  addOptionValues,
  createProductOption,
  deleteOptionValue,
  deleteProductOption,
  deleteVariant,
  generateMissingVariants,
  listProductOptions,
  listVariants,
  updateVariant,
} from './variant.service';
import { resetCatalogTables } from './testing';
import type { CreateProductInput } from './schemas';

beforeEach(async () => {
  await resetCatalogTables();
});

async function shoesFixture() {
  const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
  return category;
}

/** A simple, option-less product — the "one default variant" shape. */
async function simpleProduct(categoryId: string) {
  const input: CreateProductInput = {
    product: { slug: 'basic-shoe', nameAr: 'حذاء أساسي', nameEn: 'Basic Shoe', categoryId },
    variants: [{ sku: 'SHOE-BASIC', priceMinor: 10000 }],
  };
  return createProduct(input);
}

describe('createProductOption / addOptionValues', () => {
  it('adds a new option with values to an existing product', async () => {
    const category = await shoesFixture();
    const product = await simpleProduct(category.id);

    const option = await createProductOption(product.id, {
      nameAr: 'اللون',
      nameEn: 'Color',
      values: [
        { valueAr: 'أسود', valueEn: 'Black' },
        { valueAr: 'أبيض', valueEn: 'White' },
      ],
    });

    expect(option.nameEn).toBe('Color');
    expect(option.values).toHaveLength(2);
  });

  it('rejects a duplicate option name on the same product', async () => {
    const category = await shoesFixture();
    const product = await simpleProduct(category.id);
    await createProductOption(product.id, {
      nameAr: 'اللون',
      nameEn: 'Color',
      values: [{ valueAr: 'أسود', valueEn: 'Black' }],
    });
    await expect(
      createProductOption(product.id, {
        nameAr: 'لون آخر',
        nameEn: 'Color',
        values: [{ valueAr: 'أبيض', valueEn: 'White' }],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('adds more values to an existing option', async () => {
    const category = await shoesFixture();
    const product = await simpleProduct(category.id);
    const option = await createProductOption(product.id, {
      nameAr: 'اللون',
      nameEn: 'Color',
      values: [{ valueAr: 'أسود', valueEn: 'Black' }],
    });

    const added = await addOptionValues(option.id, [{ valueAr: 'أحمر', valueEn: 'Red' }]);
    expect(added).toHaveLength(1);

    const [refetched] = await listProductOptions(product.id);
    expect(refetched?.values.map((v) => v.valueEn)).toEqual(['Black', 'Red']);
  });
});

describe('generateMissingVariants', () => {
  it('a product with no options gets exactly one default variant', async () => {
    const category = await shoesFixture();
    const product = await db.product.create({
      data: {
        slug: 'no-options',
        nameAr: 'بدون خيارات',
        nameEn: 'No Options',
        categoryId: category.id,
      },
    });

    const created = await generateMissingVariants(product.id);
    expect(created).toHaveLength(1);
    expect(created[0]!.priceMinor).toBe(0);

    // Calling again is a no-op — the default variant already exists.
    const second = await generateMissingVariants(product.id);
    expect(second).toHaveLength(0);
  });

  it('generates the full cartesian product for a two-option matrix, leaving nothing missing', async () => {
    const category = await shoesFixture();
    const product = await simpleProduct(category.id);
    // simpleProduct already made one default variant with no options — this
    // exercises the option-based path from a product that already has one
    // variant on record, proving generation doesn't depend on starting empty.
    await createProductOption(product.id, {
      nameAr: 'اللون',
      nameEn: 'Color',
      values: [
        { valueAr: 'أسود', valueEn: 'Black' },
        { valueAr: 'أبيض', valueEn: 'White' },
      ],
    });
    await createProductOption(product.id, {
      nameAr: 'المقاس',
      nameEn: 'Size',
      values: [
        { valueAr: '40', valueEn: '40' },
        { valueAr: '41', valueEn: '41' },
        { valueAr: '42', valueEn: '42' },
      ],
    });

    const created = await generateMissingVariants(product.id);
    expect(created).toHaveLength(6); // 2 colors x 3 sizes

    const skus = new Set(created.map((v) => v.sku));
    expect(skus.size).toBe(6); // every generated SKU is unique
  });

  it('generating again after adding one more option value only creates the new combinations, leaving edited variants untouched', async () => {
    const category = await shoesFixture();
    const product = await simpleProduct(category.id);
    const color = await createProductOption(product.id, {
      nameAr: 'اللون',
      nameEn: 'Color',
      values: [{ valueAr: 'أسود', valueEn: 'Black' }],
    });
    const [black] = await generateMissingVariants(product.id);
    expect(black).toBeDefined();

    // Admin edits the Black variant's price. Stock is deliberately not
    // editable here as of P08 — it moves only through
    // `inventory.adjustStock`, so this asserts the price survives instead.
    await updateVariant(black!.id, { priceMinor: 5000 });

    // A new color value is added.
    await addOptionValues(color.id, [{ valueAr: 'أبيض', valueEn: 'White' }]);
    const secondBatch = await generateMissingVariants(product.id);
    expect(secondBatch).toHaveLength(1); // only "White" is new

    const all = await listVariants(product.id);
    // simpleProduct's own pre-existing default variant (1) + Black (1) + White (1).
    expect(all).toHaveLength(3);
    const editedBlack = all.find((v) => v.id === black!.id)!;
    expect(editedBlack.priceMinor).toBe(5000); // untouched by the second generation
  });

  it('handles a large matrix (3 colors x 5 sizes x 2 materials = 30 variants) with unique SKUs', async () => {
    const category = await shoesFixture();
    const product = await simpleProduct(category.id);
    await createProductOption(product.id, {
      nameAr: 'اللون',
      nameEn: 'Color',
      values: ['Black', 'White', 'Red'].map((v) => ({ valueAr: v, valueEn: v })),
    });
    await createProductOption(product.id, {
      nameAr: 'المقاس',
      nameEn: 'Size',
      values: ['38', '39', '40', '41', '42'].map((v) => ({ valueAr: v, valueEn: v })),
    });
    await createProductOption(product.id, {
      nameAr: 'الخامة',
      nameEn: 'Material',
      values: ['Leather', 'Canvas'].map((v) => ({ valueAr: v, valueEn: v })),
    });

    const created = await generateMissingVariants(product.id);
    expect(created).toHaveLength(30);
    expect(new Set(created.map((v) => v.sku)).size).toBe(30);
  });
});

describe('updateVariant — stock is not writable here (P08)', () => {
  it('refuses a stock field instead of quietly ignoring it', async () => {
    const category = await shoesFixture();
    const product = await simpleProduct(category.id);
    const [variant] = await listVariants(product.id);

    // Rejected rather than stripped: a caller that thinks it just set the
    // stock and gets a success back would be badly misled. Stock moves only
    // through `inventory.adjustStock`, which records why.
    await expect(updateVariant(variant!.id, { stockQuantity: 99 } as never)).rejects.toThrow();
    await expect(updateVariant(variant!.id, { trackInventory: false } as never)).rejects.toThrow();
    await expect(updateVariant(variant!.id, { lowStockThreshold: 3 } as never)).rejects.toThrow();

    const [after] = await listVariants(product.id);
    expect(after!.stockQuantity).toBe(variant!.stockQuantity);
    expect(after!.trackInventory).toBe(true);
  });
});

describe('updateVariant — pricing invariants', () => {
  it('refuses a compare-at price that is not above the real price', async () => {
    const category = await shoesFixture();
    const product = await simpleProduct(category.id);
    const [variant] = await listVariants(product.id);

    await expect(
      updateVariant(variant!.id, { priceMinor: 10000, compareAtMinor: 10000 }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { reasonCode: 'compare_at_not_above_price' },
    });
  });

  it('catches a price rise that invalidates an existing compare-at price', async () => {
    const category = await shoesFixture();
    const product = await simpleProduct(category.id);
    const [variant] = await listVariants(product.id);
    await updateVariant(variant!.id, { priceMinor: 10000, compareAtMinor: 15000 });

    // The call changes only the price, but the stored compare-at is now
    // below it — the invariant is checked against the resulting row.
    await expect(updateVariant(variant!.id, { priceMinor: 20000 })).rejects.toMatchObject({
      details: { reasonCode: 'compare_at_not_above_price' },
    });
  });

  it('refuses a negative or fractional price', async () => {
    const category = await shoesFixture();
    const product = await simpleProduct(category.id);
    const [variant] = await listVariants(product.id);

    await expect(updateVariant(variant!.id, { priceMinor: -1 })).rejects.toThrow();
    await expect(updateVariant(variant!.id, { priceMinor: 10.5 })).rejects.toThrow();
  });

  it('refuses a sale price at or above the regular price, and an inverted window', async () => {
    const category = await shoesFixture();
    const product = await simpleProduct(category.id);
    const [variant] = await listVariants(product.id);
    await updateVariant(variant!.id, { priceMinor: 10000 });

    await expect(updateVariant(variant!.id, { salePriceMinor: 10000 })).rejects.toMatchObject({
      details: { reasonCode: 'sale_not_below_price' },
    });
    await expect(
      updateVariant(variant!.id, {
        saleStartsAt: new Date('2026-02-01'),
        saleEndsAt: new Date('2026-01-01'),
      }),
    ).rejects.toMatchObject({ details: { reasonCode: 'sale_window_inverted' } });
  });

  it('accepts a genuine discount', async () => {
    const category = await shoesFixture();
    const product = await simpleProduct(category.id);
    const [variant] = await listVariants(product.id);

    const updated = await updateVariant(variant!.id, {
      priceMinor: 10000,
      compareAtMinor: 12000,
      salePriceMinor: 8000,
    });
    expect(updated.compareAtMinor).toBe(12000);
    expect(updated.salePriceMinor).toBe(8000);
  });
});

describe('updateVariant', () => {
  it('edits fields without touching the option combination', async () => {
    const category = await shoesFixture();
    const product = await simpleProduct(category.id);
    const [variant] = await listVariants(product.id);

    const updated = await updateVariant(variant!.id, { priceMinor: 7500, sku: 'SHOE-NEW-SKU' });
    expect(updated.priceMinor).toBe(7500);
    expect(updated.sku).toBe('SHOE-NEW-SKU');
  });

  it('rejects a duplicate SKU', async () => {
    const category = await shoesFixture();
    const product = await simpleProduct(category.id);
    await createProductOption(product.id, {
      nameAr: 'اللون',
      nameEn: 'Color',
      values: [
        { valueAr: 'أسود', valueEn: 'Black' },
        { valueAr: 'أبيض', valueEn: 'White' },
      ],
    });
    const created = await generateMissingVariants(product.id);
    const [first, second] = created;

    await expect(updateVariant(second!.id, { sku: first!.sku })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('optimistic concurrency: a stale expectedUpdatedAt is rejected', async () => {
    const category = await shoesFixture();
    const product = await simpleProduct(category.id);
    const [variant] = await listVariants(product.id);

    const staleTimestamp = variant!.updatedAt;
    await updateVariant(variant!.id, { priceMinor: 1234 }); // someone else's edit lands first

    await expect(
      updateVariant(variant!.id, { priceMinor: 9999 }, staleTimestamp),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('deleteVariant', () => {
  it('deletes a variant of a draft product freely', async () => {
    const category = await shoesFixture();
    const product = await simpleProduct(category.id);
    await createProductOption(product.id, {
      nameAr: 'اللون',
      nameEn: 'Color',
      values: [
        { valueAr: 'أسود', valueEn: 'Black' },
        { valueAr: 'أبيض', valueEn: 'White' },
      ],
    });
    const created = await generateMissingVariants(product.id);
    await deleteVariant(created[0]!.id);
    // simpleProduct's default variant (1) + the remaining generated one (1).
    expect(await listVariants(product.id)).toHaveLength(2);
  });

  it('refuses to delete the last variant of a PUBLISHED product', async () => {
    const category = await shoesFixture();
    const product = await simpleProduct(category.id);
    const [variant] = await listVariants(product.id);
    await publishProduct(product.id);

    await expect(deleteVariant(variant!.id)).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
  });
});

describe('deleteProductOption / deleteOptionValue', () => {
  it('blocks deleting an option value still used by a variant', async () => {
    const category = await shoesFixture();
    const product = await simpleProduct(category.id);
    const option = await createProductOption(product.id, {
      nameAr: 'اللون',
      nameEn: 'Color',
      values: [{ valueAr: 'أسود', valueEn: 'Black' }],
    });
    await generateMissingVariants(product.id);

    await expect(deleteOptionValue(option.values[0]!.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('allows deleting an option once its variants are gone', async () => {
    const category = await shoesFixture();
    const product = await simpleProduct(category.id);
    const option = await createProductOption(product.id, {
      nameAr: 'اللون',
      nameEn: 'Color',
      values: [{ valueAr: 'أسود', valueEn: 'Black' }],
    });
    const created = await generateMissingVariants(product.id);
    for (const variant of created) await deleteVariant(variant.id);

    await deleteProductOption(option.id);
    expect(await listProductOptions(product.id)).toHaveLength(0);
  });
});
