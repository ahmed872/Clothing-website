import { beforeEach, describe, expect, it } from 'vitest';

import { createCategory } from '@/modules/catalog/category.service';
import { createProduct, publishProduct } from '@/modules/catalog/product.service';
import { getProductDetailBySlug } from '@/modules/catalog/product-detail.service';
import { listProducts } from '@/modules/catalog/product-listing.service';
import { applyBulkPrice } from '@/modules/catalog/bulk-pricing.service';
import { resetCatalogTables } from '@/modules/catalog/testing';

import { adjustStock, setInventoryPolicy } from './inventory.service';

/**
 * P08 §5/§16: the store and the admin must never disagree about stock or
 * price.
 *
 * There is no second source to keep in sync — the storefront reads the same
 * `Variant` columns the inventory service writes, through the same
 * `resolveVariantStockStatus` and `resolveEffectivePrice` helpers. These
 * tests prove that end to end rather than assuming it: adjust stock or
 * change a price through the admin path, then read the customer-facing
 * query and check the number that comes back.
 */

beforeEach(async () => {
  await resetCatalogTables();
});

async function publishedShoe(stockQuantity: number, lowStockThreshold = 0) {
  const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
  const product = await createProduct({
    product: {
      slug: 'runner',
      nameAr: 'حذاء الجري',
      nameEn: 'Running Shoe',
      categoryId: category.id,
    },
    variants: [{ sku: 'RUN-BLK-41', priceMinor: 45000, stockQuantity, lowStockThreshold }],
  });
  await publishProduct(product.id);
  return { product, variant: product.variants[0]! };
}

describe('storefront reads what inventory writes', () => {
  it('a stock adjustment is visible on the product page', async () => {
    const { variant } = await publishedShoe(2);

    await adjustStock({ variantId: variant.id, delta: 8, reason: 'RESTOCK' });

    const detail = await getProductDetailBySlug('runner');
    expect(detail?.variants[0]?.stockQuantity).toBe(10);
    expect(detail?.variants[0]?.stockStatus).toBe('in-stock');
  });

  it('selling the last unit shows as out of stock, not as a stale count', async () => {
    const { variant } = await publishedShoe(1);

    await adjustStock({ variantId: variant.id, delta: -1, reason: 'MANUAL' });

    const detail = await getProductDetailBySlug('runner');
    expect(detail?.variants[0]?.stockQuantity).toBe(0);
    expect(detail?.variants[0]?.stockStatus).toBe('out-of-stock');

    const listing = await listProducts({});
    expect(listing.items[0]?.stockStatus).toBe('out-of-stock');
  });

  it('the low-stock threshold means the same thing in the listing and on the page', async () => {
    const { variant } = await publishedShoe(10, 3);

    await adjustStock({ variantId: variant.id, setTo: 3, reason: 'CORRECTION' });

    const detail = await getProductDetailBySlug('runner');
    const listing = await listProducts({});
    expect(detail?.variants[0]?.stockStatus).toBe('low-stock');
    expect(listing.items[0]?.stockStatus).toBe('low-stock');
  });

  it('an untracked variant reads as available to a customer whatever the count says', async () => {
    const { variant } = await publishedShoe(0);

    await setInventoryPolicy(variant.id, { trackInventory: false });

    const detail = await getProductDetailBySlug('runner');
    // The admin screen calls this "not tracked"; a customer only needs to
    // know they can buy it. Same underlying row, one extra distinction that
    // only matters to whoever counts the shelf.
    expect(detail?.variants[0]?.stockStatus).toBe('in-stock');
  });

  it('a bulk price change is the price the store quotes', async () => {
    const { variant } = await publishedShoe(5);

    await applyBulkPrice({
      variantIds: [variant.id],
      operation: { kind: 'percentage', percent: -20 },
    });

    const detail = await getProductDetailBySlug('runner');
    expect(detail?.variants[0]?.price.currentMinor).toBe(36000);

    const listing = await listProducts({});
    expect(listing.items[0]?.price?.currentMinor).toBe(36000);
  });
});
