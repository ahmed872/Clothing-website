import { beforeEach, describe, expect, it } from 'vitest';

import { listVariantsForAdmin } from './admin-variant-listing.service';
import { createCategory } from './category.service';
import { createProduct, publishProduct } from './product.service';
import { createProductOption, generateMissingVariants, updateVariant } from './variant.service';
import { resetCatalogTables } from './testing';

/**
 * The one listing both P08 admin screens read. What matters here is that
 * every filter and every page boundary is resolved in SQL, and that a
 * variant is named the same way wherever an admin meets it.
 */

beforeEach(async () => {
  await resetCatalogTables();
});

async function shoesWithVariants() {
  const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
  const product = await createProduct({
    product: {
      slug: 'runner',
      nameAr: 'حذاء الجري',
      nameEn: 'Running Shoe',
      categoryId: category.id,
    },
    variants: [{ sku: 'RUN-BASE', priceMinor: 45000, stockQuantity: 5 }],
  });

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
    ],
  });
  await generateMissingVariants(product.id);
  await publishProduct(product.id);
  return { category, product };
}

describe('listVariantsForAdmin — naming', () => {
  it('names a generated variant by its option values, in both locales', async () => {
    await shoesWithVariants();

    const { items } = await listVariantsForAdmin({ sort: 'sku-asc' });
    const labelled = items.filter((item) => item.variantLabelEn !== null);

    expect(labelled.length).toBeGreaterThan(0);
    expect(labelled.map((item) => item.variantLabelEn)).toContain('Black / 40');
    expect(labelled.map((item) => item.variantLabelAr)).toContain('أسود / 40');
  });

  it('leaves an option-less variant unnamed, so the caller can fall back to its SKU', async () => {
    const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
    await createProduct({
      product: { slug: 'plain', nameAr: 'حذاء', nameEn: 'Plain', categoryId: category.id },
      variants: [{ sku: 'PLAIN-1', priceMinor: 1000 }],
    });

    const { items } = await listVariantsForAdmin({});
    expect(items[0]?.variantLabelEn).toBeNull();
    expect(items[0]?.sku).toBe('PLAIN-1');
  });

  it('prefers an explicit label over the composed one', async () => {
    const { product } = await shoesWithVariants();
    const target = (await listVariantsForAdmin({ productId: product.id, sort: 'sku-asc' }))
      .items[0]!;
    await updateVariant(target.variantId, { labelEn: 'House favourite', labelAr: 'الأكثر مبيعًا' });

    const { items } = await listVariantsForAdmin({ productId: product.id, sort: 'sku-asc' });
    const updated = items.find((item) => item.variantId === target.variantId);
    expect(updated?.variantLabelEn).toBe('House favourite');
  });
});

describe('listVariantsForAdmin — filtering happens in SQL', () => {
  it('filters by stock state, including the low-stock column comparison', async () => {
    const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
    await createProduct({
      product: { slug: 'mixed', nameAr: 'متنوع', nameEn: 'Mixed', categoryId: category.id },
      variants: [{ sku: 'LOW-1', priceMinor: 1000, stockQuantity: 2, lowStockThreshold: 5 }],
    });
    await createProduct({
      product: { slug: 'empty', nameAr: 'فارغ', nameEn: 'Empty', categoryId: category.id },
      variants: [{ sku: 'OUT-1', priceMinor: 1000, stockQuantity: 0 }],
    });
    await createProduct({
      product: { slug: 'plenty', nameAr: 'وفير', nameEn: 'Plenty', categoryId: category.id },
      variants: [{ sku: 'IN-1', priceMinor: 1000, stockQuantity: 50, lowStockThreshold: 5 }],
    });

    expect((await listVariantsForAdmin({ stock: 'low_stock' })).items.map((i) => i.sku)).toEqual([
      'LOW-1',
    ]);
    expect((await listVariantsForAdmin({ stock: 'out_of_stock' })).items.map((i) => i.sku)).toEqual(
      ['OUT-1'],
    );
    const inStock = (await listVariantsForAdmin({ stock: 'in_stock' })).items.map((i) => i.sku);
    expect(inStock).toContain('IN-1');
    expect(inStock).not.toContain('OUT-1');
  });

  it('searches SKUs and product names, and scopes to a product', async () => {
    const { product } = await shoesWithVariants();

    expect((await listVariantsForAdmin({ q: 'RUN-BASE' })).total).toBe(1);
    expect((await listVariantsForAdmin({ q: 'running shoe' })).total).toBeGreaterThan(1);
    expect((await listVariantsForAdmin({ q: 'nothing-matches-this' })).total).toBe(0);
    expect((await listVariantsForAdmin({ productId: product.id })).total).toBe(5);
  });

  it('pages in the database, with a stable order across page boundaries', async () => {
    await shoesWithVariants();

    const first = await listVariantsForAdmin({ sort: 'sku-asc', pageSize: 2, page: 1 });
    const second = await listVariantsForAdmin({ sort: 'sku-asc', pageSize: 2, page: 2 });

    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(5);
    expect(first.pageCount).toBe(3);
    // No row appears on two pages, which is what the `id` tiebreaker buys.
    const ids = new Set([...first.items, ...second.items].map((item) => item.variantId));
    expect(ids.size).toBe(4);
  });

  it('caps the page size rather than letting a URL ask for the whole table', async () => {
    await shoesWithVariants();
    const result = await listVariantsForAdmin({ pageSize: 10_000 });
    expect(result.pageSize).toBe(100);
  });
});

describe('listVariantsForAdmin — sorting', () => {
  it('sorts by price in both directions', async () => {
    const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
    for (const [index, priceMinor] of [30000, 10000, 20000].entries()) {
      await createProduct({
        product: {
          slug: `p-${index}`,
          nameAr: 'منتج',
          nameEn: 'Product',
          categoryId: category.id,
        },
        variants: [{ sku: `SKU-${index}`, priceMinor }],
      });
    }

    expect(
      (await listVariantsForAdmin({ sort: 'price-asc' })).items.map((i) => i.priceMinor),
    ).toEqual([10000, 20000, 30000]);
    expect(
      (await listVariantsForAdmin({ sort: 'price-desc' })).items.map((i) => i.priceMinor),
    ).toEqual([30000, 20000, 10000]);
  });

  it('defaults to the lowest stock first — what is closest to running out', async () => {
    const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
    for (const [index, stockQuantity] of [9, 1, 4].entries()) {
      await createProduct({
        product: {
          slug: `s-${index}`,
          nameAr: 'منتج',
          nameEn: 'Product',
          categoryId: category.id,
        },
        variants: [{ sku: `STK-${index}`, priceMinor: 1000, stockQuantity }],
      });
    }

    expect((await listVariantsForAdmin({})).items.map((i) => i.stockQuantity)).toEqual([1, 4, 9]);
  });
});
