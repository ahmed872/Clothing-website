import { beforeEach, describe, expect, it } from 'vitest';

import { createCategory } from './category.service';
import { createBrand } from './brand.service';
import { createAttributeDefinition } from './attribute.service';
import { createProduct, updateProduct, publishProduct, getProduct } from './product.service';
import { resetCatalogTables } from './testing';
import type { CreateProductInput } from './schemas';

beforeEach(async () => {
  await resetCatalogTables();
});

async function carsFixture() {
  const category = await createCategory({ slug: 'cars', nameAr: 'سيارات', nameEn: 'Cars' });
  await createAttributeDefinition({
    categoryId: category.id,
    key: 'fuel_type',
    labelAr: 'نوع الوقود',
    labelEn: 'Fuel type',
    type: 'SELECT',
    allowedValues: ['Petrol', 'Hybrid', 'Electric'],
    required: true,
  });
  const brand = await createBrand({
    slug: 'mercedes-benz',
    nameAr: 'مرسيدس',
    nameEn: 'Mercedes-Benz',
  });
  return { category, brand };
}

function simpleProductInput(categoryId: string, brandId?: string): CreateProductInput {
  return {
    product: {
      slug: 's-class',
      nameAr: 'مرسيدس اس كلاس',
      nameEn: 'Mercedes S-Class',
      categoryId,
      brandId,
      attributes: { fuel_type: 'Hybrid' },
    },
    variants: [{ sku: 'MB-S-CLASS-2024', priceMinor: 12_500_000, stockQuantity: 3 }],
  };
}

describe('createProduct — a simple product (no options)', () => {
  it('creates the product with exactly one default variant', async () => {
    const { category, brand } = await carsFixture();
    const product = await createProduct(simpleProductInput(category.id, brand.id));

    expect(product.status).toBe('DRAFT');
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0]?.sku).toBe('MB-S-CLASS-2024');
    expect(product.attributes).toEqual({ fuel_type: 'Hybrid' });
  });

  it('rejects a category that does not exist', async () => {
    const input = simpleProductInput('00000000-0000-0000-0000-000000000000');
    await expect(createProduct(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a brand that does not exist', async () => {
    const { category } = await carsFixture();
    const input = simpleProductInput(category.id, '00000000-0000-0000-0000-000000000000');
    await expect(createProduct(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects invalid attributes for the category', async () => {
    const { category } = await carsFixture();
    const input = simpleProductInput(category.id);
    input.product.attributes = { fuel_type: 'Diesel' }; // not in allowedValues
    await expect(createProduct(input)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects missing required core fields (schema-level)', async () => {
    const { category } = await carsFixture();
    const input = simpleProductInput(category.id);
    // @ts-expect-error — intentionally omitting a required field to prove the schema catches it
    delete input.product.nameEn;
    await expect(createProduct(input)).rejects.toThrow();
  });

  it('rejects a product with zero variants', async () => {
    const { category } = await carsFixture();
    const input = simpleProductInput(category.id);
    input.variants = [];
    await expect(createProduct(input)).rejects.toThrow();
  });

  it('rejects a duplicate slug', async () => {
    const { category } = await carsFixture();
    await createProduct(simpleProductInput(category.id));
    await expect(createProduct(simpleProductInput(category.id))).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('rejects a duplicate SKU across products', async () => {
    const { category } = await carsFixture();
    await createProduct(simpleProductInput(category.id));
    const second = simpleProductInput(category.id);
    second.product.slug = 's-class-amg';
    // same SKU as the first product's variant
    await expect(createProduct(second)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a negative price', async () => {
    const { category } = await carsFixture();
    const input = simpleProductInput(category.id);
    input.variants[0]!.priceMinor = -1;
    await expect(createProduct(input)).rejects.toThrow();
  });
});

describe('createProduct — a product with options', () => {
  it('creates one variant per option combination', async () => {
    const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
    const input: CreateProductInput = {
      product: {
        slug: 'running-shoe',
        nameAr: 'حذاء رياضي',
        nameEn: 'Running shoe',
        categoryId: category.id,
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
        {
          nameAr: 'المقاس',
          nameEn: 'Size',
          values: [
            { valueAr: '40', valueEn: '40' },
            { valueAr: '41', valueEn: '41' },
          ],
        },
      ],
      variants: [
        {
          sku: 'SHOE-BLK-40',
          priceMinor: 35000,
          optionValues: [
            { optionNameEn: 'Color', valueEn: 'Black' },
            { optionNameEn: 'Size', valueEn: '40' },
          ],
        },
        {
          sku: 'SHOE-BLK-41',
          priceMinor: 35000,
          optionValues: [
            { optionNameEn: 'Color', valueEn: 'Black' },
            { optionNameEn: 'Size', valueEn: '41' },
          ],
        },
        {
          sku: 'SHOE-WHT-40',
          priceMinor: 35000,
          optionValues: [
            { optionNameEn: 'Color', valueEn: 'White' },
            { optionNameEn: 'Size', valueEn: '40' },
          ],
        },
        {
          sku: 'SHOE-WHT-41',
          priceMinor: 35000,
          optionValues: [
            { optionNameEn: 'Color', valueEn: 'White' },
            { optionNameEn: 'Size', valueEn: '41' },
          ],
        },
      ],
    };

    const product = await createProduct(input);
    expect(product.variants).toHaveLength(4);
    expect(new Set(product.variants.map((v) => v.sku)).size).toBe(4);
  });

  it('rejects a missing combination', async () => {
    const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
    const input: CreateProductInput = {
      product: { slug: 'shoe', nameAr: 'حذاء', nameEn: 'Shoe', categoryId: category.id },
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
          sku: 'SHOE-BLK',
          priceMinor: 35000,
          optionValues: [{ optionNameEn: 'Color', valueEn: 'Black' }],
        },
      ],
    };
    await expect(createProduct(input)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a duplicate combination', async () => {
    const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
    const input: CreateProductInput = {
      product: { slug: 'shoe', nameAr: 'حذاء', nameEn: 'Shoe', categoryId: category.id },
      options: [
        { nameAr: 'اللون', nameEn: 'Color', values: [{ valueAr: 'أسود', valueEn: 'Black' }] },
      ],
      variants: [
        {
          sku: 'SHOE-1',
          priceMinor: 35000,
          optionValues: [{ optionNameEn: 'Color', valueEn: 'Black' }],
        },
        {
          sku: 'SHOE-2',
          priceMinor: 35000,
          optionValues: [{ optionNameEn: 'Color', valueEn: 'Black' }],
        },
      ],
    };
    await expect(createProduct(input)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('publishing', () => {
  it('publishes a valid product', async () => {
    const { category } = await carsFixture();
    const created = await createProduct(simpleProductInput(category.id));
    const published = await publishProduct(created.id);
    expect(published.status).toBe('PUBLISHED');
  });

  it('rejects PUBLISHED status requested with a missing name — guarded at the schema layer', async () => {
    // nameAr/nameEn are required (min length 1) by productCoreInputSchema, so
    // an invalid product never reaches the publishability check at all.
    const { category } = await carsFixture();
    const input = simpleProductInput(category.id);
    input.product.status = 'PUBLISHED';
    input.product.nameAr = '';
    await expect(createProduct(input)).rejects.toThrow();
  });

  it('getProduct returns null for an id that does not exist', async () => {
    expect(await getProduct('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('updateProduct re-validates attributes against a new category, even when attributes itself is not part of the call', async () => {
    const { category, brand } = await carsFixture();
    const created = await createProduct(simpleProductInput(category.id, brand.id));

    const shoes = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
    // Moving to a category with no `fuel_type` definition: the existing
    // attributes (`{ fuel_type: 'Hybrid' }`) are not valid for it, and the
    // move is rejected rather than silently carrying stale attributes over.
    await expect(updateProduct(created.id, { categoryId: shoes.id })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    // Providing attributes valid for the new category in the same call succeeds.
    await expect(
      updateProduct(created.id, { categoryId: shoes.id, attributes: {} }),
    ).resolves.toMatchObject({ categoryId: shoes.id });
  });
});

describe('updateProduct — optimistic concurrency', () => {
  it('rejects an update whose expectedUpdatedAt is stale', async () => {
    const { category, brand } = await carsFixture();
    const created = await createProduct(simpleProductInput(category.id, brand.id));
    const staleTimestamp = created.updatedAt;

    // Admin A saves first.
    await updateProduct(created.id, { nameEn: 'Edited by A' });

    // Admin B, who read the product before A's save, tries to save too —
    // their expectedUpdatedAt no longer matches the current row.
    await expect(
      updateProduct(created.id, { nameEn: 'Edited by B' }, staleTimestamp),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // A's edit survived; B's was never silently applied.
    const final = await getProduct(created.id);
    expect(final?.nameEn).toBe('Edited by A');
  });

  it('accepts an update whose expectedUpdatedAt matches the current row', async () => {
    const { category, brand } = await carsFixture();
    const created = await createProduct(simpleProductInput(category.id, brand.id));
    await expect(
      updateProduct(created.id, { nameEn: 'Edited' }, created.updatedAt),
    ).resolves.toMatchObject({ nameEn: 'Edited' });
  });
});
