/**
 * P10 e2e fixture — one always-restocked product for the order specs.
 *
 * The order accessibility and checkout specs have to *place* orders, and
 * placing an order consumes stock. Running them against the demo catalog
 * would drain the single unit each demo car has and leave every other spec
 * looking at an out-of-stock storefront — a test that breaks its neighbours
 * is not a test. So the order specs get their own product, with enough stock
 * that a whole suite run cannot exhaust it.
 *
 * Every write goes through a sanctioned domain service (`createCategory`,
 * `createProduct`, `publishProduct`, `adjustStock`) — the fixture is created
 * the way a store owner would create it, so nothing here can put the catalog
 * into a state the application itself could not produce.
 *
 * Idempotent: re-running tops the stock back up rather than creating a
 * second product.
 *
 * Run with: pnpm db:seed-e2e-orders
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env', quiet: true });

const { createCategory, getCategoryBySlug, createProduct, getProductBySlug, publishProduct } =
  await import('../src/modules/catalog/index.js');
const { adjustStock } = await import('../src/modules/inventory/index.js');
const { db, isAppError } = await import('../src/modules/core/index.js');
const { E2E_ORDER_FIXTURE } = await import('../e2e/fixtures/order-fixture.js');

const TARGET_STOCK = 500;

const category =
  (await getCategoryBySlug(E2E_ORDER_FIXTURE.categorySlug)) ??
  (await createCategory({
    slug: E2E_ORDER_FIXTURE.categorySlug,
    nameAr: E2E_ORDER_FIXTURE.categoryNameAr,
    nameEn: E2E_ORDER_FIXTURE.categoryNameEn,
  }));

const existing = await getProductBySlug(E2E_ORDER_FIXTURE.productSlug);
if (!existing) {
  const created = await createProduct({
    product: {
      slug: E2E_ORDER_FIXTURE.productSlug,
      nameAr: E2E_ORDER_FIXTURE.productNameAr,
      nameEn: E2E_ORDER_FIXTURE.productNameEn,
      descriptionAr: E2E_ORDER_FIXTURE.descriptionAr,
      descriptionEn: E2E_ORDER_FIXTURE.descriptionEn,
      categoryId: category.id,
    },
    variants: [
      {
        sku: E2E_ORDER_FIXTURE.sku,
        priceMinor: E2E_ORDER_FIXTURE.priceMinor,
        stockQuantity: TARGET_STOCK,
      },
    ],
  });
  await publishProduct(created.id);
}

// A plain read — `getProductBySlug` returns the product without its variants
// and the catalog module exposes no lookup by SKU, so the row is read
// directly. Nothing here writes outside a domain service.
const variant = await db.variant.findUniqueOrThrow({ where: { sku: E2E_ORDER_FIXTURE.sku } });

// An absolute correction, not a delta: the point is "there are 500 of these
// again", whatever previous runs consumed, and `setTo` says exactly that
// while still writing an audited adjustment row like any other movement.
if (variant.stockQuantity !== TARGET_STOCK) {
  try {
    await adjustStock({
      variantId: variant.id,
      setTo: TARGET_STOCK,
      reason: 'CORRECTION',
      note: 'e2e order fixture restock',
    });
  } catch (error) {
    // Playwright runs spec files in parallel, and more than one can hit
    // this same seed script at once: both read a below-target stock level,
    // then both request "set to 500" — the second arrives after the first
    // already committed it. The outcome either invocation wanted (the
    // variant sitting at `TARGET_STOCK`) is already true, so a
    // `stock_unchanged` rejection here is a benign double-restock, not a
    // real failure.
    if (!isAppError(error) || error.details?.reasonCode !== 'stock_unchanged') throw error;
  }
}

console.log(
  `✓ e2e order fixture ready: ${E2E_ORDER_FIXTURE.productSlug} (${E2E_ORDER_FIXTURE.sku}) @ ${TARGET_STOCK}`,
);
await db.$disconnect();
