import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/modules/core';
import { resetCatalogTables } from '@/modules/catalog/testing';
import { resetIdentityTables } from '@/modules/identity/testing';
import { createUser } from '@/modules/identity/user.service';

/**
 * A product created from the admin has to be sellable.
 *
 * It was not. `Variant.stockQuantity` defaults to `0` and `trackInventory`
 * to `true`, and the create form collected only a SKU and a price — so
 * every product a store owner added was born out of stock, showed
 * "غير متوفر" to customers, and could only be fixed from the Inventory
 * screen they had no reason to know existed. The reported symptom was
 * exactly that: "why is everything out of stock, and where do I type the
 * quantity?"
 *
 * These pin the fix at the boundary the form actually calls.
 */

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

const authMock = vi.fn();
vi.mock('@/modules/identity/auth', () => ({ auth: authMock }));

const { createProductAction } = await import('./product-actions');
const { createCategory, listVariants } = await import('@/modules/catalog');

const ACTOR_ID = '00000000-0000-4000-8000-0000000000bb';

async function seedOwner(): Promise<void> {
  const user = await createUser({
    email: 'stock-owner@example.com',
    password: 'stock-pass-1234',
    role: 'OWNER',
  });
  await db.user.update({ where: { id: user.id }, data: { id: ACTOR_ID } });
  authMock.mockResolvedValue({
    user: { id: ACTOR_ID, email: 'stock-owner@example.com', name: null, role: 'OWNER' },
    expires: '2099-01-01T00:00:00.000Z',
  });
}

let counter = 0;
async function createWithStock(stockQuantity?: number) {
  counter += 1;
  const category = await createCategory({
    slug: `stock-cat-${counter}`,
    nameAr: 'فئة',
    nameEn: 'Category',
  });

  const result = await createProductAction(
    {
      product: {
        slug: `stock-product-${counter}`,
        nameAr: 'منتج',
        nameEn: 'Product',
        categoryId: category.id,
      },
      initialVariant: { sku: `STOCK-${counter}`, priceMinor: 15_000, stockQuantity },
    },
    'en',
  );

  expect(result.ok).toBe(true);
  const variants = await listVariants(result.data!.id);
  return variants[0]!;
}

beforeEach(async () => {
  await resetCatalogTables();
  await resetIdentityTables();
  authMock.mockReset();
  await seedOwner();
});

describe('opening stock on a new product', () => {
  it('stores the quantity the owner typed, so the product is in stock immediately', async () => {
    const variant = await createWithStock(25);
    expect(variant.stockQuantity).toBe(25);
  });

  it('is still zero when none was given — the default, but now a stated one', async () => {
    const variant = await createWithStock(undefined);
    expect(variant.stockQuantity).toBe(0);
  });

  it('accepts zero explicitly, for something not in stock yet', async () => {
    const variant = await createWithStock(0);
    expect(variant.stockQuantity).toBe(0);
  });

  it('keeps inventory tracking on, so stock still moves when an order is placed', async () => {
    const variant = await createWithStock(5);
    expect(variant.trackInventory).toBe(true);
  });

  it('refuses a negative quantity rather than storing one', async () => {
    counter += 1;
    const category = await createCategory({
      slug: `neg-cat-${counter}`,
      nameAr: 'فئة',
      nameEn: 'Category',
    });

    const result = await createProductAction(
      {
        product: {
          slug: `neg-product-${counter}`,
          nameAr: 'منتج',
          nameEn: 'Product',
          categoryId: category.id,
        },
        initialVariant: { sku: `NEG-${counter}`, priceMinor: 15_000, stockQuantity: -5 },
      },
      'en',
    );

    expect(result.ok).toBe(false);
    expect(await db.product.count()).toBe(0);
  });
});
