import { beforeEach, describe, expect, it } from 'vitest';

import { createCategory } from './category.service';
import { createBrand } from './brand.service';
import { createProduct, publishProduct } from './product.service';
import { listProductsForAdmin } from './admin-product-listing.service';
import { resetCatalogTables } from './testing';
import type { CreateProductInput } from './schemas';

beforeEach(async () => {
  await resetCatalogTables();
});

async function seedProducts() {
  const cars = await createCategory({ slug: 'cars', nameAr: 'سيارات', nameEn: 'Cars' });
  const shoes = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
  const brand = await createBrand({ slug: 'brand-a', nameAr: 'أ', nameEn: 'Brand A' });

  const draft = await createProduct({
    product: {
      slug: 'draft-car',
      nameAr: 'سيارة مسودة',
      nameEn: 'Draft Car',
      categoryId: cars.id,
      brandId: brand.id,
    },
    variants: [{ sku: 'CAR-DRAFT', priceMinor: 50000, stockQuantity: 5 }],
  } satisfies CreateProductInput);

  const published = await createProduct({
    product: {
      slug: 'published-shoe',
      nameAr: 'حذاء منشور',
      nameEn: 'Published Shoe',
      categoryId: shoes.id,
      status: 'PUBLISHED',
    },
    variants: [{ sku: 'SHOE-PUB', priceMinor: 20000, stockQuantity: 0, trackInventory: true }],
  } satisfies CreateProductInput);

  return { cars, shoes, brand, draft, published };
}

describe('listProductsForAdmin', () => {
  it('lists every status by default (not just PUBLISHED, unlike the storefront listing)', async () => {
    await seedProducts();
    const result = await listProductsForAdmin({});
    expect(result.total).toBe(2);
    expect(result.items.map((i) => i.status).sort()).toEqual(['DRAFT', 'PUBLISHED']);
  });

  it('filters by status', async () => {
    await seedProducts();
    const result = await listProductsForAdmin({ status: 'DRAFT' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.nameEn).toBe('Draft Car');
  });

  it('filters by category', async () => {
    const { cars } = await seedProducts();
    const result = await listProductsForAdmin({ categoryId: cars.id });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.nameEn).toBe('Draft Car');
  });

  it('filters by brand', async () => {
    const { brand } = await seedProducts();
    const result = await listProductsForAdmin({ brandId: brand.id });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.nameEn).toBe('Draft Car');
  });

  it('text search matches name and SKU', async () => {
    await seedProducts();
    expect((await listProductsForAdmin({ q: 'Published' })).items).toHaveLength(1);
    expect((await listProductsForAdmin({ q: 'SHOE-PUB' })).items).toHaveLength(1);
    expect((await listProductsForAdmin({ q: 'nonexistent-term' })).items).toHaveLength(0);
  });

  it('filters by stock status', async () => {
    await seedProducts();
    const outOfStock = await listProductsForAdmin({ stock: 'out_of_stock' });
    expect(outOfStock.items.map((i) => i.nameEn)).toEqual(['Published Shoe']);

    const inStock = await listProductsForAdmin({ stock: 'in_stock' });
    expect(inStock.items.map((i) => i.nameEn)).toEqual(['Draft Car']);
  });

  it('paginates server-side — page 1 and page 2 never overlap and respect pageSize', async () => {
    const category = await createCategory({ slug: 'many', nameAr: 'كثير', nameEn: 'Many' });
    for (let i = 0; i < 5; i++) {
      await createProduct({
        product: {
          slug: `item-${i}`,
          nameAr: `منتج ${i}`,
          nameEn: `Item ${i}`,
          categoryId: category.id,
        },
        variants: [{ sku: `SKU-${i}`, priceMinor: 1000 }],
      });
    }

    const page1 = await listProductsForAdmin({ pageSize: 2, page: 1, sort: 'name-asc' });
    const page2 = await listProductsForAdmin({ pageSize: 2, page: 2, sort: 'name-asc' });
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.pageCount).toBe(3);
    const page1Ids = new Set(page1.items.map((i) => i.id));
    for (const item of page2.items) expect(page1Ids.has(item.id)).toBe(false);
  });

  it('sorts by name', async () => {
    await seedProducts();
    const asc = await listProductsForAdmin({ sort: 'name-asc' });
    expect(asc.items.map((i) => i.nameEn)).toEqual(['Draft Car', 'Published Shoe']);
    const desc = await listProductsForAdmin({ sort: 'name-desc' });
    expect(desc.items.map((i) => i.nameEn)).toEqual(['Published Shoe', 'Draft Car']);
  });

  it('excludes soft-deleted products', async () => {
    const { draft } = await seedProducts();
    await publishProduct(draft.id); // still visible while published
    expect((await listProductsForAdmin({})).total).toBe(2);

    const { softDeleteProduct } = await import('./product.service');
    await softDeleteProduct(draft.id);
    expect((await listProductsForAdmin({})).total).toBe(1);
  });

  it('reports variant count and a SKU summary', async () => {
    await seedProducts();
    const result = await listProductsForAdmin({ q: 'Draft' });
    expect(result.items[0]!.variantCount).toBe(1);
    expect(result.items[0]!.skuSummary).toBe('CAR-DRAFT');
  });
});
