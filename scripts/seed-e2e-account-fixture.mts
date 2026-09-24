/**
 * P12 e2e fixture — two always-restocked products for the account specs
 * (`account-acceptance.spec.ts`'s guest-cart-merge journey), mirroring
 * `seed-e2e-orders-fixture.mts` exactly: every write goes through a
 * sanctioned domain service, and the script is idempotent — re-running tops
 * the stock back up rather than creating a duplicate product.
 *
 * Run with: pnpm db:seed-e2e-account
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env', quiet: true });

const { createCategory, getCategoryBySlug, createProduct, getProductBySlug, publishProduct } =
  await import('../src/modules/catalog/index.js');
const { adjustStock } = await import('../src/modules/inventory/index.js');
const { db, isAppError } = await import('../src/modules/core/index.js');
const { E2E_ACCOUNT_FIXTURE } = await import('../e2e/fixtures/account-fixture.js');

const TARGET_STOCK = 500;

const category =
  (await getCategoryBySlug(E2E_ACCOUNT_FIXTURE.categorySlug)) ??
  (await createCategory({
    slug: E2E_ACCOUNT_FIXTURE.categorySlug,
    nameAr: E2E_ACCOUNT_FIXTURE.categoryNameAr,
    nameEn: E2E_ACCOUNT_FIXTURE.categoryNameEn,
  }));

for (const product of [E2E_ACCOUNT_FIXTURE.productA, E2E_ACCOUNT_FIXTURE.productB]) {
  const existing = await getProductBySlug(product.slug);
  if (!existing) {
    const created = await createProduct({
      product: {
        slug: product.slug,
        nameAr: product.nameAr,
        nameEn: product.nameEn,
        categoryId: category.id,
      },
      variants: [{ sku: product.sku, priceMinor: product.priceMinor, stockQuantity: TARGET_STOCK }],
    });
    await publishProduct(created.id);
  }

  const variant = await db.variant.findUniqueOrThrow({ where: { sku: product.sku } });
  if (variant.stockQuantity !== TARGET_STOCK) {
    try {
      await adjustStock({
        variantId: variant.id,
        setTo: TARGET_STOCK,
        reason: 'CORRECTION',
        note: 'e2e account fixture restock',
      });
    } catch (error) {
      // Playwright runs spec files in parallel, and more than one can hit
      // this same `beforeAll` at once: two invocations both reading a
      // below-target stock level, then both requesting "set to 500" — the
      // second arrives after the first already committed it, so the
      // read-then-act check above is not itself race-free. That is fine
      // here (unlike the application code this fixture exercises, which
      // closes exactly this kind of race with a DB-arbitrated claim): the
      // outcome either invocation wanted — the variant sitting at
      // `TARGET_STOCK` — is already true, so a `stock_unchanged` rejection
      // is not a real failure, only a benign double-restock.
      if (!isAppError(error) || error.details?.reasonCode !== 'stock_unchanged') throw error;
    }
  }
}
