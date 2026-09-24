import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';

import { createCategory } from './category.service';
import { createBrand } from './brand.service';
import { createAttributeDefinition } from './attribute.service';
import { createProduct, publishProduct } from './product.service';
import {
  listProducts,
  getFilterableAttributes,
  getRelatedProducts,
} from './product-listing.service';
import { resetCatalogTables } from './testing';

beforeEach(async () => {
  // See product-detail.service.test.ts: `resetCatalogTables` doesn't own
  // `Review`/`Customer`/`User`, which this suite's rating-aggregate test
  // creates directly.
  await db.review.deleteMany();
  await db.customer.deleteMany();
  await db.user.deleteMany();
  await resetCatalogTables();
});

async function electronicsFixture() {
  const category = await createCategory({
    slug: 'electronics',
    nameAr: 'إلكترونيات',
    nameEn: 'Electronics',
  });
  await createAttributeDefinition({
    categoryId: category.id,
    key: 'color',
    labelAr: 'اللون',
    labelEn: 'Color',
    type: 'SELECT',
    allowedValues: ['Black', 'White'],
    filterable: true,
  });
  const brandA = await createBrand({ slug: 'brand-a', nameAr: 'أ', nameEn: 'Brand A' });
  const brandB = await createBrand({ slug: 'brand-b', nameAr: 'ب', nameEn: 'Brand B' });
  return { category, brandA, brandB };
}

async function makeProduct(opts: {
  slug: string;
  categoryId: string;
  brandId?: string;
  priceMinor: number;
  featured?: boolean;
  color?: string;
  stockQuantity?: number;
  publish?: boolean;
}) {
  const product = await createProduct({
    product: {
      slug: opts.slug,
      nameAr: opts.slug,
      nameEn: opts.slug,
      categoryId: opts.categoryId,
      brandId: opts.brandId,
      featured: opts.featured,
      attributes: opts.color ? { color: opts.color } : {},
    },
    variants: [
      {
        sku: opts.slug.toUpperCase(),
        priceMinor: opts.priceMinor,
        stockQuantity: opts.stockQuantity ?? 10,
      },
    ],
  });
  if (opts.publish ?? true) await publishProduct(product.id);
  return product;
}

describe('listProducts', () => {
  it('only returns published products', async () => {
    const { category } = await electronicsFixture();
    await makeProduct({ slug: 'published-one', categoryId: category.id, priceMinor: 1000 });
    await makeProduct({
      slug: 'still-draft',
      categoryId: category.id,
      priceMinor: 1000,
      publish: false,
    });

    const result = await listProducts({ categoryId: category.id });
    expect(result.items.map((i) => i.slug)).toEqual(['published-one']);
  });

  it('scopes to a category and its descendants', async () => {
    const { category } = await electronicsFixture();
    const phones = await createCategory({
      parentId: category.id,
      slug: 'phones',
      nameAr: 'هواتف',
      nameEn: 'Phones',
    });
    const other = await createCategory({ slug: 'other', nameAr: 'أخرى', nameEn: 'Other' });
    await makeProduct({ slug: 'a-phone', categoryId: phones.id, priceMinor: 1000 });
    await makeProduct({ slug: 'unrelated', categoryId: other.id, priceMinor: 1000 });

    const result = await listProducts({ categoryId: category.id });
    expect(result.items.map((i) => i.slug)).toEqual(['a-phone']);
  });

  it('filters by brand', async () => {
    const { category, brandA, brandB } = await electronicsFixture();
    await makeProduct({
      slug: 'from-a',
      categoryId: category.id,
      brandId: brandA.id,
      priceMinor: 1000,
    });
    await makeProduct({
      slug: 'from-b',
      categoryId: category.id,
      brandId: brandB.id,
      priceMinor: 1000,
    });

    const result = await listProducts({ categoryId: category.id, brandIds: [brandA.id] });
    expect(result.items.map((i) => i.slug)).toEqual(['from-a']);
  });

  it('filters by a filterable attribute value', async () => {
    const { category } = await electronicsFixture();
    await makeProduct({
      slug: 'black-one',
      categoryId: category.id,
      priceMinor: 1000,
      color: 'Black',
    });
    await makeProduct({
      slug: 'white-one',
      categoryId: category.id,
      priceMinor: 1000,
      color: 'White',
    });

    const result = await listProducts({
      categoryId: category.id,
      attributeFilters: { color: ['Black'] },
    });
    expect(result.items.map((i) => i.slug)).toEqual(['black-one']);
  });

  it('filters by price range using the lowest variant price', async () => {
    const { category } = await electronicsFixture();
    await makeProduct({ slug: 'cheap', categoryId: category.id, priceMinor: 1000 });
    await makeProduct({ slug: 'pricey', categoryId: category.id, priceMinor: 9000 });

    const result = await listProducts({ categoryId: category.id, priceMinMinor: 5000 });
    expect(result.items.map((i) => i.slug)).toEqual(['pricey']);
  });

  it('excludes out-of-stock products when inStockOnly is set', async () => {
    const { category } = await electronicsFixture();
    await makeProduct({
      slug: 'in-stock',
      categoryId: category.id,
      priceMinor: 1000,
      stockQuantity: 5,
    });
    await makeProduct({
      slug: 'sold-out',
      categoryId: category.id,
      priceMinor: 1000,
      stockQuantity: 0,
    });

    const result = await listProducts({ categoryId: category.id, inStockOnly: true });
    expect(result.items.map((i) => i.slug)).toEqual(['in-stock']);
    const allItems = await listProducts({ categoryId: category.id });
    expect(allItems.items.find((i) => i.slug === 'sold-out')?.stockStatus).toBe('out-of-stock');
  });

  it('sorts by price ascending and descending', async () => {
    const { category } = await electronicsFixture();
    await makeProduct({ slug: 'mid', categoryId: category.id, priceMinor: 5000 });
    await makeProduct({ slug: 'low', categoryId: category.id, priceMinor: 1000 });
    await makeProduct({ slug: 'high', categoryId: category.id, priceMinor: 9000 });

    const asc = await listProducts({ categoryId: category.id, sort: 'price-asc' });
    expect(asc.items.map((i) => i.slug)).toEqual(['low', 'mid', 'high']);

    const desc = await listProducts({ categoryId: category.id, sort: 'price-desc' });
    expect(desc.items.map((i) => i.slug)).toEqual(['high', 'mid', 'low']);
  });

  it('sorts featured products first', async () => {
    const { category } = await electronicsFixture();
    await makeProduct({ slug: 'plain', categoryId: category.id, priceMinor: 1000 });
    await makeProduct({ slug: 'star', categoryId: category.id, priceMinor: 1000, featured: true });

    const result = await listProducts({ categoryId: category.id, sort: 'featured' });
    expect(result.items[0]?.slug).toBe('star');
  });

  it('paginates', async () => {
    const { category } = await electronicsFixture();
    for (let i = 0; i < 5; i++) {
      await makeProduct({ slug: `p-${i}`, categoryId: category.id, priceMinor: 1000 + i });
    }

    const page1 = await listProducts({
      categoryId: category.id,
      pageSize: 2,
      page: 1,
      sort: 'price-asc',
    });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.pageCount).toBe(3);

    const page3 = await listProducts({
      categoryId: category.id,
      pageSize: 2,
      page: 3,
      sort: 'price-asc',
    });
    expect(page3.items).toHaveLength(1);
  });

  it('matches free text against name and description in either locale', async () => {
    const { category } = await electronicsFixture();
    await createProduct({
      product: {
        slug: 'unique-widget',
        nameAr: 'قطعة فريدة',
        nameEn: 'Unique Widget',
        categoryId: category.id,
      },
      variants: [{ sku: 'UW-1', priceMinor: 1000 }],
    }).then((p) => publishProduct(p.id));
    await makeProduct({ slug: 'other-thing', categoryId: category.id, priceMinor: 1000 });

    const result = await listProducts({ q: 'widget' });
    expect(result.items.map((i) => i.slug)).toEqual(['unique-widget']);
  });

  it('reports available brands scoped to category, unaffected by attribute filters', async () => {
    const { category, brandA, brandB } = await electronicsFixture();
    await makeProduct({
      slug: 'from-a',
      categoryId: category.id,
      brandId: brandA.id,
      priceMinor: 1000,
      color: 'Black',
    });
    await makeProduct({
      slug: 'from-b',
      categoryId: category.id,
      brandId: brandB.id,
      priceMinor: 1000,
      color: 'White',
    });

    const result = await listProducts({
      categoryId: category.id,
      attributeFilters: { color: ['Black'] },
    });
    expect(result.availableBrands.map((b) => b.slug).sort()).toEqual(['brand-a', 'brand-b']);
  });

  it('includes a real rating aggregate only when published reviews exist', async () => {
    const { category } = await electronicsFixture();
    const product = await makeProduct({
      slug: 'reviewed',
      categoryId: category.id,
      priceMinor: 1000,
    });
    const user = await db.user.create({ data: { email: 'r1@example.com', role: 'CUSTOMER' } });
    const customer = await db.customer.create({ data: { userId: user.id } });
    await db.review.create({
      data: { productId: product.id, customerId: customer.id, rating: 4, status: 'PUBLISHED' },
    });

    const result = await listProducts({ categoryId: category.id });
    const item = result.items.find((i) => i.slug === 'reviewed');
    expect(item?.rating).toEqual({ value: 4, count: 1 });
  });
});

describe('getFilterableAttributes', () => {
  it('returns only definitions marked filterable', async () => {
    const { category } = await electronicsFixture();
    await createAttributeDefinition({
      categoryId: category.id,
      key: 'weight_grams',
      labelAr: 'الوزن',
      labelEn: 'Weight',
      type: 'NUMBER',
      filterable: false,
    });

    const filters = await getFilterableAttributes(category.id);
    expect(filters.map((f) => f.key)).toEqual(['color']);
    expect(filters[0]?.allowedValues).toEqual(['Black', 'White']);
  });
});

describe('getRelatedProducts', () => {
  it('excludes the product itself and stays within its category', async () => {
    const { category } = await electronicsFixture();
    const main = await makeProduct({ slug: 'main', categoryId: category.id, priceMinor: 1000 });
    await makeProduct({ slug: 'sibling', categoryId: category.id, priceMinor: 2000 });
    const other = await createCategory({
      slug: 'unrelated-cat',
      nameAr: 'غير ذلك',
      nameEn: 'Unrelated',
    });
    await makeProduct({ slug: 'far-away', categoryId: other.id, priceMinor: 3000 });

    const related = await getRelatedProducts(main.id, category.id);
    expect(related.map((r) => r.slug)).toEqual(['sibling']);
  });
});
