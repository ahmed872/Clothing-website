import { beforeEach, describe, expect, it } from 'vitest';

import {
  createCategory,
  createBrand,
  createAttributeDefinition,
  createProduct,
  publishProduct,
} from '@/modules/catalog';
import { resetCatalogTables } from '@/modules/catalog/testing';

import { postgresSearchProvider } from './postgres-provider';

beforeEach(async () => {
  await resetCatalogTables();
});

describe('postgresSearchProvider', () => {
  it('resolves categorySlug and brandSlugs and returns matching, real facets', async () => {
    const category = await createCategory({ slug: 'cars', nameAr: 'سيارات', nameEn: 'Cars' });
    await createAttributeDefinition({
      categoryId: category.id,
      key: 'fuel_type',
      labelAr: 'نوع الوقود',
      labelEn: 'Fuel type',
      type: 'SELECT',
      allowedValues: ['Petrol', 'Electric'],
      filterable: true,
    });
    const brand = await createBrand({ slug: 'tesla', nameAr: 'تسلا', nameEn: 'Tesla' });
    const product = await createProduct({
      product: {
        slug: 'model-3',
        nameAr: 'موديل 3',
        nameEn: 'Model 3',
        categoryId: category.id,
        brandId: brand.id,
        attributes: { fuel_type: 'Electric' },
      },
      variants: [{ sku: 'MODEL-3', priceMinor: 150_000_00 }],
    });
    await publishProduct(product.id);

    const result = await postgresSearchProvider.search({
      categorySlug: 'cars',
      brandSlugs: ['tesla'],
    });

    expect(result.items.map((i) => i.slug)).toEqual(['model-3']);
    expect(result.facets.attributes.map((a) => a.key)).toEqual(['fuel_type']);
    expect(result.facets.brands.map((b) => b.slug)).toEqual(['tesla']);
    expect(result.facets.priceRange).toEqual({ minMinor: 150_000_00, maxMinor: 150_000_00 });
  });

  it('returns no results and no attribute facets for an unknown category slug, without throwing', async () => {
    const result = await postgresSearchProvider.search({ categorySlug: 'does-not-exist' });
    expect(result.items).toEqual([]);
    expect(result.facets.attributes).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('runs a free-text query with no category scope at all', async () => {
    const category = await createCategory({ slug: 'misc', nameAr: 'متفرقات', nameEn: 'Misc' });
    const product = await createProduct({
      product: { slug: 'gizmo', nameAr: 'جهاز', nameEn: 'Gizmo', categoryId: category.id },
      variants: [{ sku: 'GIZMO-1', priceMinor: 1000 }],
    });
    await publishProduct(product.id);

    const result = await postgresSearchProvider.search({ q: 'gizmo' });
    expect(result.items.map((i) => i.slug)).toEqual(['gizmo']);
  });
});
