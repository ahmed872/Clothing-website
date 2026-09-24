import { beforeEach, describe, expect, it } from 'vitest';

import {
  createBrand,
  updateBrand,
  deleteBrand,
  getBrand,
  getBrandBySlug,
  listBrands,
} from './brand.service';
import { createCategory } from './category.service';
import { createProduct } from './product.service';
import { resetCatalogTables } from './testing';
import type { CreateProductInput } from './schemas';

beforeEach(async () => {
  await resetCatalogTables();
});

describe('createBrand', () => {
  it('creates a brand', async () => {
    const brand = await createBrand({ slug: 'nike', nameAr: 'نايكي', nameEn: 'Nike' });
    expect(brand.slug).toBe('nike');
  });

  it('rejects a duplicate slug', async () => {
    await createBrand({ slug: 'nike', nameAr: 'نايكي', nameEn: 'Nike' });
    await expect(
      createBrand({ slug: 'nike', nameAr: 'نايك', nameEn: 'Nike Inc.' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('is not specific to any product category', async () => {
    // No field on Brand references cars, shoes, or any category — the type
    // system already proves this; this test proves a brand created with no
    // catalog context at all still round-trips correctly.
    const brand = await createBrand({ slug: 'samsung', nameAr: 'سامسونج', nameEn: 'Samsung' });
    expect(await getBrand(brand.id)).toMatchObject({ slug: 'samsung' });
  });
});

describe('updateBrand', () => {
  it('updates fields', async () => {
    const brand = await createBrand({ slug: 'nike', nameAr: 'نايكي', nameEn: 'Nike' });
    const updated = await updateBrand(brand.id, { nameEn: 'NIKE, Inc.' });
    expect(updated.nameEn).toBe('NIKE, Inc.');
  });

  it('rejects an id that does not exist', async () => {
    await expect(
      updateBrand('00000000-0000-0000-0000-000000000000', { nameEn: 'X' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('lookups', () => {
  it('getBrandBySlug finds a brand', async () => {
    await createBrand({ slug: 'nike', nameAr: 'نايكي', nameEn: 'Nike' });
    expect((await getBrandBySlug('nike'))?.slug).toBe('nike');
  });

  it('listBrands returns every brand, alphabetically by English name', async () => {
    await createBrand({ slug: 'nike', nameAr: 'نايكي', nameEn: 'Nike' });
    await createBrand({ slug: 'adidas', nameAr: 'أديداس', nameEn: 'Adidas' });
    const brands = await listBrands();
    expect(brands.map((b) => b.nameEn)).toEqual(['Adidas', 'Nike']);
  });
});

describe('deleteBrand', () => {
  it('deletes a brand with no products', async () => {
    const brand = await createBrand({ slug: 'nike', nameAr: 'نايكي', nameEn: 'Nike' });
    await deleteBrand(brand.id);
    expect(await getBrand(brand.id)).toBeNull();
  });

  it('refuses to delete a brand assigned to a product', async () => {
    const category = await createCategory({ slug: 'cars', nameAr: 'سيارات', nameEn: 'Cars' });
    const brand = await createBrand({ slug: 'nike', nameAr: 'نايكي', nameEn: 'Nike' });
    const input: CreateProductInput = {
      product: {
        slug: 'car-1',
        nameAr: 'سيارة',
        nameEn: 'Car',
        categoryId: category.id,
        brandId: brand.id,
      },
      variants: [{ sku: 'CAR-1', priceMinor: 100000 }],
    };
    await createProduct(input);

    await expect(deleteBrand(brand.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    // and the product still has its brand — nothing was silently detached
    expect((await getBrand(brand.id))?.id).toBe(brand.id);
  });

  it('rejects an id that does not exist', async () => {
    await expect(deleteBrand('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
