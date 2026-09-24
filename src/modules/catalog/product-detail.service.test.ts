import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';

import { createCategory } from './category.service';
import { createAttributeDefinition } from './attribute.service';
import { createProduct, publishProduct } from './product.service';
import { getProductDetailBySlug, getProductReviews } from './product-detail.service';
import { resetCatalogTables } from './testing';

beforeEach(async () => {
  // `resetCatalogTables` only owns catalog's own tables; these tests also
  // create `Review`/`Customer`/`User` rows directly (`identity`/`customers`
  // are still stubs with no service — and no `testing.ts` — of their own to
  // reuse), so they're cleared here too rather than accumulating across runs.
  await db.review.deleteMany();
  await db.customer.deleteMany();
  await db.user.deleteMany();
  await resetCatalogTables();
});

describe('getProductDetailBySlug', () => {
  it('returns null for a product that does not exist', async () => {
    expect(await getProductDetailBySlug('nope')).toBeNull();
  });

  it('returns null for a DRAFT product — the storefront never shows unpublished products', async () => {
    const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
    await createProduct({
      product: { slug: 'draft-shoe', nameAr: 'حذاء', nameEn: 'Shoe', categoryId: category.id },
      variants: [{ sku: 'SHOE-1', priceMinor: 1000 }],
    });

    expect(await getProductDetailBySlug('draft-shoe')).toBeNull();
  });

  it('assembles breadcrumb, options, variants and specifications for a published product', async () => {
    const root = await createCategory({ slug: 'fashion', nameAr: 'أزياء', nameEn: 'Fashion' });
    const shoes = await createCategory({
      parentId: root.id,
      slug: 'shoes',
      nameAr: 'أحذية',
      nameEn: 'Shoes',
    });
    await createAttributeDefinition({
      categoryId: shoes.id,
      key: 'material',
      labelAr: 'الخامة',
      labelEn: 'Material',
      type: 'TEXT',
    });

    const created = await createProduct({
      product: {
        slug: 'running-shoe',
        nameAr: 'حذاء جري',
        nameEn: 'Running Shoe',
        categoryId: shoes.id,
        attributes: { material: 'Mesh' },
      },
      options: [
        {
          nameAr: 'اللون',
          nameEn: 'Color',
          values: [
            { valueAr: 'أسود', valueEn: 'Black' },
            { valueAr: 'أبيض', valueEn: 'White' },
          ],
        },
      ],
      variants: [
        {
          sku: 'SHOE-BLACK',
          priceMinor: 20000,
          stockQuantity: 5,
          optionValues: [{ optionNameEn: 'Color', valueEn: 'Black' }],
        },
        {
          sku: 'SHOE-WHITE',
          priceMinor: 22000,
          stockQuantity: 0,
          optionValues: [{ optionNameEn: 'Color', valueEn: 'White' }],
        },
      ],
    });
    await publishProduct(created.id);

    const detail = await getProductDetailBySlug('running-shoe');
    expect(detail).not.toBeNull();
    expect(detail!.breadcrumb.map((c) => c.slug)).toEqual(['fashion', 'shoes']);
    expect(detail!.options).toHaveLength(1);
    expect(detail!.options[0]?.values.map((v) => v.valueEn)).toEqual(['Black', 'White']);
    expect(detail!.variants).toHaveLength(2);
    expect(detail!.variants.find((v) => v.sku === 'SHOE-WHITE')?.stockStatus).toBe('out-of-stock');
    expect(detail!.defaultVariantId).toBe(detail!.variants[0]?.id);
    expect(detail!.specifications).toEqual([
      { key: 'material', labelAr: 'الخامة', labelEn: 'Material', unit: null, value: 'Mesh' },
    ]);
    expect(detail!.rating).toBeNull();
  });
});

describe('getProductReviews', () => {
  it('returns an empty list rather than a fabricated rating when there are no reviews', async () => {
    const category = await createCategory({ slug: 'bags', nameAr: 'حقائب', nameEn: 'Bags' });
    const product = await createProduct({
      product: { slug: 'tote', nameAr: 'حقيبة', nameEn: 'Tote', categoryId: category.id },
      variants: [{ sku: 'TOTE-1', priceMinor: 5000 }],
    });
    await publishProduct(product.id);

    expect(await getProductReviews(product.id)).toEqual([]);
  });

  it('returns real published reviews, newest first, and excludes non-published ones', async () => {
    const category = await createCategory({ slug: 'bags2', nameAr: 'حقائب', nameEn: 'Bags' });
    const product = await createProduct({
      product: { slug: 'tote2', nameAr: 'حقيبة', nameEn: 'Tote', categoryId: category.id },
      variants: [{ sku: 'TOTE-2', priceMinor: 5000 }],
    });
    await publishProduct(product.id);

    const user = await db.user.create({
      data: { email: 'reviewer@example.com', name: 'Sara', role: 'CUSTOMER' },
    });
    const customer = await db.customer.create({ data: { userId: user.id } });
    await db.review.create({
      data: {
        productId: product.id,
        customerId: customer.id,
        rating: 5,
        body: 'Great',
        status: 'PUBLISHED',
      },
    });

    const pendingUser = await db.user.create({
      data: { email: 'pending@example.com', role: 'CUSTOMER' },
    });
    const pendingCustomer = await db.customer.create({ data: { userId: pendingUser.id } });
    await db.review.create({
      data: { productId: product.id, customerId: pendingCustomer.id, rating: 1, status: 'PENDING' },
    });

    const reviews = await getProductReviews(product.id);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ rating: 5, body: 'Great', customerName: 'Sara' });
  });
});
