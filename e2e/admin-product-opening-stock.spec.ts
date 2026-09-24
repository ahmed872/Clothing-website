import { execSync } from 'node:child_process';

import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/authenticated';

/**
 * A product added from the admin is sellable straight away.
 *
 * It was not. The create form asked for a SKU and a price and nothing else,
 * so every product was created with the schema's default of zero stock and
 * shown to customers as out of stock — and the only cure was the Inventory
 * screen, which a store owner adding their first product has no reason to
 * open. The reported symptom was exactly that: everything out of stock, and
 * nowhere to type the quantity.
 *
 * So this drives the whole thing the way the owner does: fill the form
 * including the new quantity field, publish, then look at the storefront.
 */

test.beforeAll(() => {
  execSync('pnpm db:seed-e2e-admins', { cwd: process.cwd(), stdio: 'inherit' });
});

test.describe.configure({ timeout: 180_000 });

const RUN = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
const BASE = 'http://127.0.0.1:3000';

async function setLocale(page: Page, locale: 'ar' | 'en'): Promise<void> {
  await page.context().addCookies([{ name: 'luxedrive-locale', value: locale, url: BASE }]);
}

let categoryCounter = 0;

/**
 * A category of this spec's own, created through the admin like everything
 * else here.
 *
 * Not one that already exists: the demo "Cars" category carries required
 * attribute definitions (fuel type, transmission, engine…), and a product
 * form for it cannot be submitted without them — which has nothing to do
 * with what this spec is about. `orders-checkout-acceptance` makes its own
 * category for the same reason.
 */
async function createCategory(page: Page): Promise<string> {
  categoryCounter += 1;
  const name = `Stock category ${categoryCounter} ${RUN}`;

  await page.goto('/admin/categories/new');
  await page.getByLabel('English name').fill(name);
  await page.getByLabel('Arabic name').fill(`فئة مخزون ${categoryCounter} ${RUN}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL('**/admin/categories', { timeout: 60_000 });
  return name;
}

/** Fills the create form and returns the product's slug. */
async function createProduct(
  page: Page,
  tag: string,
  quantity: string,
  categoryName: string,
): Promise<string> {
  const slug = `stock-${tag}-${RUN}`;

  await page.goto('/admin/products/new');
  const form = page.locator('main form');
  await expect(form).toBeVisible({ timeout: 60_000 });

  await form.getByLabel('English name').fill(`Opening stock ${tag} ${RUN}`);
  await form.getByLabel('Arabic name').fill(`مخزون افتتاحي ${tag}`);
  await form.getByLabel('Slug').fill(slug);
  await form.getByLabel('Category').click();
  await page.getByRole('option', { name: categoryName }).click();
  await form.getByLabel('SKU').fill(`OPEN-${tag}-${RUN}`.toUpperCase());
  await form.getByLabel('Price').fill('400');
  await form.getByLabel('Quantity in stock').fill(quantity);

  await form.getByRole('button', { name: 'Save as draft' }).click();
  await page.waitForURL(/\/admin\/products\/[0-9a-f-]{36}$/, { timeout: 60_000 });

  // Publish it, since a draft appears nowhere in the storefront regardless
  // of its stock.
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Product published').first()).toBeVisible({ timeout: 30_000 });

  return slug;
}

test.describe('opening stock', () => {
  test('a quantity typed on the create form makes the product in stock', async ({
    ownerContext,
  }) => {
    const page = await ownerContext.newPage();
    await setLocale(page, 'en');
    const categoryName = await createCategory(page);

    const slug = await createProduct(page, 'yes', '25', categoryName);

    // The Inventory screen agrees. Searched, not scrolled: that list is
    // paginated and a brand-new SKU is not on the first page.
    const sku = `OPEN-YES-${RUN}`.toUpperCase();
    await page.goto(`/admin/inventory?q=${encodeURIComponent(sku)}`);
    await expect(page.locator('tbody tr').filter({ hasText: sku })).toContainText('25');

    // …and, the point of the whole thing, so does the customer's view.
    await page.goto(`/en/p/${slug}`);
    await expect(page.getByRole('heading', { name: new RegExp(`Opening stock yes`) })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText('Out of stock')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add to Cart' })).toBeEnabled();
  });

  test('leaving it empty still yields an out-of-stock product, and says so', async ({
    ownerContext,
  }) => {
    const page = await ownerContext.newPage();
    await setLocale(page, 'en');
    const categoryName = await createCategory(page);

    const slug = await createProduct(page, 'no', '0', categoryName);

    await page.goto(`/en/p/${slug}`);
    await expect(page.getByRole('heading', { name: new RegExp(`Opening stock no`) })).toBeVisible({
      timeout: 60_000,
    });
    // Zero is a legitimate answer — the field exists so this is a choice
    // rather than something that happened to the owner.
    await expect(page.getByText('Out of stock').first()).toBeVisible();
  });

  test('the field explains what leaving it blank does', async ({ ownerContext }) => {
    const page = await ownerContext.newPage();
    await setLocale(page, 'en');

    await page.goto('/admin/products/new');
    await expect(page.getByLabel('Quantity in stock')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/shows as out of stock to customers/)).toBeVisible();
  });
});
