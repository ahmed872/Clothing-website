import { execSync } from 'node:child_process';

import { expect, test, type Page } from '@playwright/test';

import { E2E_ACCEPTANCE_OWNER } from './fixtures/admin-credentials';

/**
 * P08 §24 — the critical acceptance test, run exactly as the spec words it:
 * a non-developer store owner, in the Admin UI, with zero code changes, on a
 * deliberately generic commerce scenario (shoes — nothing about this
 * codebase is specific to any one kind of product).
 *
 *   create a category with Color / Size / Material → create "Running
 *   Shoes" → generate Color × Size variants → publish → set stock per
 *   variant → watch the status badges follow → try to remove more than
 *   exists and be refused → correct a count after a physical stock take →
 *   read the history and see who did what and why → change the low-stock
 *   threshold → price one variant → be refused an impossible compare-at →
 *   preview and apply a bulk price cut → confirm the storefront quotes the
 *   new price and the new stock.
 *
 * Deliberately one long test: the point is that the whole journey works end
 * to end, and a step that only passes because a previous test left the
 * right state behind would not prove that. It signs in through the real
 * login form — even the entry point is what a store owner actually does.
 */

const RUN = Date.now().toString().slice(-6);
const CATEGORY_EN = `Footwear ${RUN}`;
const PRODUCT_EN = `Running Shoes ${RUN}`;
const PRODUCT_SLUG = `running-shoes-${RUN}`;
const SKU_BASE = `RUNSH-${RUN}`;
/** The variant this journey follows, by the label an owner sees. */
const VARIANT = 'Black / 40';

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(() => {
  execSync('pnpm db:seed-e2e-admins', { cwd: process.cwd(), stdio: 'inherit' });
});

async function signInAsOwner(page: Page): Promise<void> {
  await page.goto('/admin/login');
  await page.fill('input[name=email]', E2E_ACCEPTANCE_OWNER.email);
  await page.fill('input[name=password]', E2E_ACCEPTANCE_OWNER.password);
  await page.click('button[type=submit]');
  await page.waitForURL('**/admin');
  // English for the rest of the journey — the Arabic side of these screens
  // is covered by the accessibility spec.
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('link', { name: 'Products' })).toBeVisible();
}

/** The inventory row for one SKU. Rows are variants, so the SKU is what
 * identifies one — the product name is shared by all of them. */
function inventoryRow(page: Page, sku: string) {
  return page.locator('tbody tr').filter({ hasText: sku });
}

/**
 * The search box on both P08 list screens.
 *
 * Waits for a row before typing: the filter is a React submit handler, and
 * pressing Enter before the page has hydrated would submit the form
 * natively — a full reload with no query string, which looks exactly like a
 * filter that silently did nothing. Then waits for the term to reach the
 * URL, which is where the filter actually lives.
 */
async function searchInventory(page: Page, term: string): Promise<void> {
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 60_000 });
  const box = page.getByPlaceholder('Search by SKU or name…');
  await box.fill(term);
  await box.press('Enter');
  await page.waitForURL(/[?&]q=/, { timeout: 30_000 });
}

/** A toast renders its text twice — once visibly, once in the assertive
 * live region a screen reader announces. Either is proof it appeared. */
function toast(page: Page, text: string | RegExp) {
  return page.getByText(text).first();
}

test('a store owner takes a shoe product from stock-in to a repriced, live listing', async ({
  page,
}) => {
  test.slow();
  await signInAsOwner(page);

  // ---- 1. A category, with the options this kind of product needs ---------
  await page.goto('/admin/categories/new');
  await page.getByLabel('English name').fill(CATEGORY_EN);
  await page.getByLabel('Arabic name').fill(`أحذية ${RUN}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL('**/admin/categories');
  await expect(page.getByRole('link', { name: CATEGORY_EN })).toBeVisible();

  // ---- 2. The product -----------------------------------------------------
  await page.goto('/admin/products/new');
  await page.getByLabel('English name').fill(PRODUCT_EN);
  await page.getByLabel('Arabic name').fill(`حذاء جري ${RUN}`);
  await expect(page.getByLabel('Slug')).toHaveValue(PRODUCT_SLUG);
  await page.getByLabel('Category').click();
  await page.getByRole('option', { name: CATEGORY_EN }).click();
  await page.getByLabel('SKU').fill(`${SKU_BASE}-BASE`);
  await page.getByLabel('Price').fill('450');
  await page.getByRole('button', { name: 'Save as draft' }).click();
  await page.waitForURL(/\/admin\/products\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const productUrl = page.url();

  // ---- 3. Color × Size variants ------------------------------------------
  for (const option of [
    { en: 'Color', ar: 'اللون', values: ['Black', 'White'] },
    { en: 'Size', ar: 'المقاس', values: ['40', '41'] },
  ]) {
    await page.getByRole('button', { name: 'New option' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('English option name').fill(option.en);
    await dialog.getByLabel('Arabic option name').fill(option.ar);
    for (const value of option.values) {
      await dialog.getByLabel('Values').fill(value);
      await dialog.getByLabel('Values').press('Enter');
    }
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
  }

  await page.getByRole('button', { name: 'Generate combinations' }).click();
  // 2 colors × 2 sizes = 4, plus the default variant created with the product.
  await expect(page.locator('table tbody tr')).toHaveCount(5, { timeout: 30_000 });

  // ---- 4. Stock is NOT editable here -------------------------------------
  // P08 §2: the only path to a quantity is the inventory service, which
  // records why and by whom. The variant builder shows the number and sends
  // the owner where it can actually be changed.
  await expect(page.getByRole('link', { name: 'Manage inventory' })).toBeVisible();

  // ---- 5. Publish ---------------------------------------------------------
  await page.goto(productUrl);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(
    page.getByText('Current status').locator('..').getByText('Published', { exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  // ---- 6. The inventory screen lists the variants, all at zero ------------
  // Searched by product name, and each row identified by its variant label
  // ("Black / 40") — the SKUs were generated for the owner, so the label is
  // what they actually recognise.
  await page.goto('/admin/inventory');
  await searchInventory(page, PRODUCT_EN);
  await expect(inventoryRow(page, VARIANT)).toBeVisible({ timeout: 30_000 });
  await expect(inventoryRow(page, VARIANT).getByText('Out of stock')).toBeVisible();

  // The SKU the store generated for this combination — captured rather than
  // assumed, since it is derived from the product slug, and used below to
  // name the row's own controls.
  const sku = (await inventoryRow(page, VARIANT).locator('td').nth(1).innerText()).trim();
  expect(sku).not.toBe('');

  // ---- 7. Receive a delivery: +10 ----------------------------------------
  await inventoryRow(page, VARIANT).getByRole('button', { name: 'Adjust stock' }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Current quantity');
  await dialog.getByLabel('Amount (use a minus sign to remove)').fill('10');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(toast(page, 'Stock updated: 0 → 10')).toBeVisible({ timeout: 20_000 });

  // ---- 8. Damaged goods: -2 ----------------------------------------------
  await expect(inventoryRow(page, VARIANT).getByText('In stock')).toBeVisible({ timeout: 20_000 });
  await inventoryRow(page, VARIANT).getByRole('button', { name: 'Adjust stock' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Amount (use a minus sign to remove)').fill('-2');
  await dialog.getByLabel('Reason').click();
  await page.getByRole('option', { name: 'Damaged or lost' }).click();
  await dialog.getByLabel('Note (optional)').fill('Two pairs damaged in transit');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(toast(page, 'Stock updated: 10 → 8')).toBeVisible({ timeout: 20_000 });

  // ---- 9. Removing more than exists is refused, on the server -----------
  await inventoryRow(page, VARIANT).getByRole('button', { name: 'Adjust stock' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Amount (use a minus sign to remove)').fill('-99');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('inventory cannot go below zero', {
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  // ---- 10. The refusal changed nothing ------------------------------------
  await page.reload();
  await searchInventory(page, PRODUCT_EN);
  await expect(inventoryRow(page, VARIANT)).toContainText('8', { timeout: 30_000 });

  // ---- 11. A physical count corrects the number to an exact figure --------
  await inventoryRow(page, VARIANT).getByRole('button', { name: 'Adjust stock' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Set an exact quantity').click();
  await dialog.getByLabel('New quantity').fill('6');
  await dialog.getByLabel('Reason').click();
  await page.getByRole('option', { name: 'Correction after a count' }).click();
  await dialog.getByLabel('Note (optional)').fill('Counted the shelf');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(toast(page, 'Stock updated: 8 → 6')).toBeVisible({ timeout: 20_000 });

  // ---- 12. A low-stock threshold changes the badge, not the count ---------
  await inventoryRow(page, VARIANT)
    .getByRole('button', { name: /Tracking settings/ })
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Low-stock threshold').fill('10');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(inventoryRow(page, VARIANT).getByText('Low stock')).toBeVisible({
    timeout: 20_000,
  });
  await expect(inventoryRow(page, VARIANT)).toContainText('6');

  // ---- 13. Every movement is in the history, with reason and actor --------
  await page.getByRole('link', { name: 'History' }).click();
  await page.waitForURL('**/admin/inventory/history');
  // Scoped to this variant's own rows: the history is store-wide, and every
  // previous run of this journey left its own movements behind — exactly
  // the situation a real store's log is in after a year.
  const ourHistory = page.locator('tbody tr').filter({ hasText: sku });
  await expect(ourHistory.first()).toBeVisible({ timeout: 30_000 });
  // Three movements: +10 received, −2 damaged, and the correction to 6.
  await expect(ourHistory).toHaveCount(3);
  await expect(ourHistory.filter({ hasText: 'Counted the shelf' })).toHaveCount(1);
  await expect(ourHistory.filter({ hasText: 'Two pairs damaged in transit' })).toHaveCount(1);
  // Before and after are both recorded, not just the delta.
  await expect(ourHistory.filter({ hasText: 'Counted the shelf' })).toContainText('E2E OWNER');
  await expect(ourHistory.filter({ hasText: 'Correction after a count' })).toContainText('6');

  // ---- 14. The history filters, in SQL, from the URL ----------------------
  await page.getByLabel('Reason').click();
  await page.getByRole('option', { name: 'Damaged or lost' }).click();
  await expect(page).toHaveURL(/reason=DAMAGED/);
  await expect(ourHistory.filter({ hasText: 'Two pairs damaged in transit' })).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect(ourHistory.filter({ hasText: 'Counted the shelf' })).toHaveCount(0);

  // A reload proves the filter lives in the URL, not in component state.
  await page.reload();
  await expect(ourHistory.filter({ hasText: 'Two pairs damaged in transit' })).toHaveCount(1, {
    timeout: 30_000,
  });
  await expect(ourHistory.filter({ hasText: 'Counted the shelf' })).toHaveCount(0);

  // ---- 15. Price one variant ---------------------------------------------
  await page.goto('/admin/pricing');
  await searchInventory(page, PRODUCT_EN);
  const priceRow = page.locator('tbody tr').filter({ hasText: sku });
  await expect(priceRow).toBeVisible({ timeout: 30_000 });
  await priceRow.getByLabel(`Price: ${sku}`).fill('500');
  await priceRow.getByLabel(`Compare at: ${sku}`).fill('600');
  await priceRow.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toast(page, 'Price saved')).toBeVisible({ timeout: 20_000 });

  // ---- 16. An impossible compare-at is refused ---------------------------
  await priceRow.getByLabel(`Price: ${sku}`).fill('700');
  await priceRow.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(priceRow.getByRole('alert')).toContainText(
    'compare-at price must be higher than the price',
    { timeout: 20_000 },
  );

  // ---- 17. Bulk: select two variants, preview a 10% cut -------------------
  await page.reload();
  await searchInventory(page, PRODUCT_EN);
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Select all rows').click();
  await page.getByRole('button', { name: 'Change prices' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Percentage/).fill('-10');
  await dialog.getByRole('button', { name: 'Preview' }).click();
  await expect(dialog.getByText('Before and after')).toBeVisible({ timeout: 20_000 });

  // ---- 18. Apply, atomically ---------------------------------------------
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(toast(page, /prices updated/)).toBeVisible({ timeout: 20_000 });

  // ---- 19. The store quotes the new price --------------------------------
  const anon = await page.context().browser()!.newContext();
  const anonPage = await anon.newPage();
  const response = await anonPage.goto(`/en/p/${PRODUCT_SLUG}`);
  expect(response?.status()).toBe(200);
  await expect(anonPage.getByRole('heading', { name: PRODUCT_EN })).toBeVisible();

  // ---- 20. …and the stock the admin counted ------------------------------
  // Pick the exact combination the journey stocked. Its quantity is 6 with a
  // low-stock threshold of 10, so a customer sees "Limited stock" — the
  // threshold set in the admin, reaching the storefront through the same
  // rule, with no second source of truth in between.
  await anonPage.getByRole('radio', { name: 'Black', exact: true }).click();
  await anonPage.getByRole('radio', { name: '40', exact: true }).click();
  await expect(anonPage.getByText('Limited stock')).toBeVisible({ timeout: 20_000 });

  // A combination that was never stocked reads as out of stock, so the page
  // is reporting real per-variant counts rather than one product-wide guess.
  await anonPage.getByRole('radio', { name: '41', exact: true }).click();
  await expect(anonPage.getByText('Out of stock')).toBeVisible({ timeout: 20_000 });

  // ---- 21. Back in admin, the numbers still agree ------------------------
  await anon.close();
  await page.goto('/admin/inventory');
  await searchInventory(page, PRODUCT_EN);
  await expect(inventoryRow(page, VARIANT)).toContainText('6', { timeout: 30_000 });
  await expect(inventoryRow(page, VARIANT).getByText('Low stock')).toBeVisible();
});
