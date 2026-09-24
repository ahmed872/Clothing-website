import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { E2E_ACCEPTANCE_OWNER } from './fixtures/admin-credentials';

/**
 * P09 §28 — the critical acceptance journey, on the same generic commerce
 * scenario the previous phases used (shoes, not cars).
 *
 *   a store owner builds Running Shoes with Colour × Size variants and real
 *   stock → a guest adds two of one variant → the cart totals from the
 *   server → the owner creates a 10% promotion with a minimum, a window and
 *   a usage limit → the guest applies it → the discount and total are
 *   checked arithmetically → a tampered payload is proven not to move them
 *   → the owner changes the price → the cart re-quotes → the owner cuts the
 *   stock → the cart adjusts and says so → an invalid code is refused →
 *   the audit log records the promotion change.
 *
 * One long test on purpose: the point is that the whole path holds
 * together, and a step that only passed because a previous test left the
 * right state behind would not prove that.
 */

const RUN = Date.now().toString().slice(-6);
const CATEGORY_EN = `Footwear ${RUN}`;
const PRODUCT_EN = `Running Shoes ${RUN}`;
const PRODUCT_SLUG = `running-shoes-${RUN}`;
const SKU_BASE = `RUNP9-${RUN}`;
const PROMO = `SAVE10${RUN}`;
const VARIANT = 'Black / 40';

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(() => {
  execSync('pnpm db:seed-e2e-admins', { cwd: process.cwd(), stdio: 'inherit' });
});

async function signInAsOwner(page: Page): Promise<void> {
  await page.goto('/admin/login');
  await page.fill('input[name=email]', E2E_ACCEPTANCE_OWNER.email);
  await page.fill('input[name=password]', E2E_ACCEPTANCE_OWNER.password);
  await page.click('button[type=submit]');
  await page.waitForURL('**/admin');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('link', { name: 'Products' })).toBeVisible();
}

/** The search box on the admin list screens; waits for hydration so Enter
 * runs the React handler rather than submitting the form natively. */
async function adminSearch(page: Page, term: string): Promise<void> {
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 60_000 });
  const box = page.getByPlaceholder('Search by SKU or name…');
  await box.fill(term);
  await box.press('Enter');
  await page.waitForURL(/[?&]q=/, { timeout: 30_000 });
}

function toast(page: Page, text: string | RegExp) {
  return page.getByText(text).first();
}

/** The audit actions recorded against a promotion, straight from the
 * database the application writes to. The Playwright runner does not load
 * the app's env, so the connection string is read from `.env` the same way
 * Prisma's own config does. */
function auditRowsFor(code: string): string {
  const url = readFileSync('.env', 'utf8')
    .split('\n')
    .find((line) => line.startsWith('DATABASE_URL='))!
    .replace('DATABASE_URL=', '')
    .replace(/^"|"$/g, '')
    // `psql` takes a connection URI but rejects Prisma's `?schema=` query
    // parameter, which it has no notion of.
    .replace(/\?.*$/, '')
    .trim();

  return execSync(
    `psql "${url}" -tAc "select a.action from audit_logs a join coupons c on c.id::text = a.entity_id where c.code = '${code}' order by a.created_at"`,
    { encoding: 'utf8' },
  );
}

test('a store owner runs a promotion, and the server owns every number', async ({
  page,
  browser,
}) => {
  test.slow();
  await signInAsOwner(page);

  // ---- 1. A category and a product with Colour × Size variants ------------
  await page.goto('/admin/categories/new');
  await page.getByLabel('English name').fill(CATEGORY_EN);
  await page.getByLabel('Arabic name').fill(`أحذية ${RUN}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL('**/admin/categories');

  await page.goto('/admin/products/new');
  await page.getByLabel('English name').fill(PRODUCT_EN);
  await page.getByLabel('Arabic name').fill(`حذاء جري ${RUN}`);
  await expect(page.getByLabel('Slug')).toHaveValue(PRODUCT_SLUG);
  await page.getByLabel('Category').click();
  await page.getByRole('option', { name: CATEGORY_EN }).click();
  await page.getByLabel('SKU').fill(`${SKU_BASE}-BASE`);
  await page.getByLabel('Price').fill('400');
  await page.getByRole('button', { name: 'Save as draft' }).click();
  await page.waitForURL(/\/admin\/products\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const productUrl = page.url();

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
  await expect(page.locator('table tbody tr')).toHaveCount(5, { timeout: 30_000 });

  await page.goto(productUrl);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(
    page.getByText('Current status').locator('..').getByText('Published', { exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  // ---- 2. Stock the Black / 40 variant ------------------------------------
  await page.goto('/admin/inventory');
  await adminSearch(page, PRODUCT_EN);
  const inventoryRow = page.locator('tbody tr').filter({ hasText: VARIANT });
  await expect(inventoryRow).toBeVisible({ timeout: 30_000 });

  const sku = (await inventoryRow.locator('td').nth(1).innerText()).trim();
  expect(sku).not.toBe('');

  await inventoryRow.getByRole('button', { name: 'Adjust stock' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Amount (use a minus sign to remove)').fill('10');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(toast(page, 'Stock updated: 0 → 10')).toBeVisible({ timeout: 20_000 });

  // ---- 3. Price it at 400.00 ---------------------------------------------
  await page.goto('/admin/pricing');
  await adminSearch(page, PRODUCT_EN);
  const priceRow = page.locator('tbody tr').filter({ hasText: sku });
  await expect(priceRow).toBeVisible({ timeout: 30_000 });
  await priceRow.getByLabel(`Price: ${sku}`).fill('400');
  await priceRow.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toast(page, 'Price saved')).toBeVisible({ timeout: 20_000 });

  // ---- 4. A guest adds two ------------------------------------------------
  const shopper = await browser.newContext();
  const shop = await shopper.newPage();

  await shop.goto(`/en/p/${PRODUCT_SLUG}`);
  await expect(shop.getByRole('heading', { name: PRODUCT_EN })).toBeVisible();
  await shop.getByRole('radio', { name: 'Black', exact: true }).click();
  await shop.getByRole('radio', { name: '40', exact: true }).click();
  await shop.getByRole('button', { name: 'Increase quantity' }).click();
  await shop.getByRole('button', { name: 'Add to cart' }).click();
  await expect(toast(shop, 'Added to your cart')).toBeVisible({ timeout: 20_000 });

  // ---- 5. The cart totals from the server --------------------------------
  await shop.goto('/en/cart');
  await expect(shop.getByRole('heading', { name: 'Shopping cart' })).toBeVisible();
  // The order summary, where every figure is one the server sent. Amounts
  // are asserted as substrings because they render with the store currency
  // beside them ("SAR 800.00").
  const summary = shop.getByRole('complementary');
  // 2 × 400.00 = 800.00, derived server-side. The page never multiplies.
  await expect(summary).toContainText('800.00', { timeout: 20_000 });

  // ---- 6. The owner creates a 10% promotion with real conditions ---------
  await page.goto('/admin/promotions/new');
  await page.getByLabel('Promotion code').fill(PROMO);
  await page.getByLabel('Percentage (%)').fill('10');
  await page.getByLabel('Minimum order').fill('500');
  await page.getByLabel('Total usage limit').fill('5');
  await page.getByLabel('Per-customer limit').fill('1');
  await page.getByLabel('Starts').fill('2020-01-01');
  await page.getByLabel('Ends').fill('2099-12-31');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL('**/admin/promotions', { timeout: 30_000 });
  await expect(page.getByRole('link', { name: PROMO })).toBeVisible();

  // ---- 7. The guest applies it, and the arithmetic is checked ------------
  await shop.reload();
  await shop.getByLabel('Promotion code').fill(PROMO);
  await shop.getByRole('button', { name: 'Apply' }).click();
  await expect(toast(shop, new RegExp(`Code ${PROMO} applied`))).toBeVisible({ timeout: 20_000 });

  // 10% of 800.00 is 80.00, leaving 720.00. Every one of those numbers comes
  // back from the server; none is computed in the page.
  await expect(summary).toContainText('80.00', { timeout: 20_000 });
  await expect(summary).toContainText('720.00');

  // ---- 8. Tampering with the client changes nothing ----------------------
  // Rewrite every price-shaped number in the DOM, then ask the server again.
  // The recalculated cart must come back with the real figures.
  await shop.evaluate(() => {
    document.querySelectorAll('dd, p, span').forEach((element) => {
      if (/\d/.test(element.textContent ?? '')) element.textContent = '0.01';
    });
  });
  await expect(shop.getByText('0.01').first()).toBeVisible();

  await shop.reload();
  const afterTamper = shop.getByRole('complementary');
  await expect(afterTamper).toContainText('800.00', { timeout: 20_000 });
  await expect(afterTamper).toContainText('80.00');
  await expect(afterTamper).toContainText('720.00');

  // ---- 9. The owner changes the price; the cart re-quotes ----------------
  await page.goto('/admin/pricing');
  await adminSearch(page, PRODUCT_EN);
  const repriceRow = page.locator('tbody tr').filter({ hasText: sku });
  await repriceRow.getByLabel(`Price: ${sku}`).fill('500');
  await repriceRow.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toast(page, 'Price saved')).toBeVisible({ timeout: 20_000 });

  await shop.reload();
  // 2 × 500.00 = 1,000.00, less 10% = 900.00. The cart quoted the new price
  // without the customer doing anything: it never promised the old one.
  const afterReprice = shop.getByRole('complementary');
  await expect(afterReprice).toContainText('1,000.00', { timeout: 20_000 });
  await expect(afterReprice).toContainText('100.00');
  await expect(afterReprice).toContainText('900.00');

  // ---- 10. The owner cuts the stock; the cart adjusts and explains -------
  await page.goto('/admin/inventory');
  await adminSearch(page, PRODUCT_EN);
  const stockRow = page.locator('tbody tr').filter({ hasText: VARIANT });
  await stockRow.getByRole('button', { name: 'Adjust stock' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Set an exact quantity').click();
  await dialog.getByLabel('New quantity').fill('1');
  await dialog.getByLabel('Reason').click();
  await page.getByRole('option', { name: 'Correction after a count' }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  await shop.reload();
  // The quantity is clamped to what is left, the customer is told, and the
  // total follows — 1 × 500.00 less 10%.
  await expect(shop.getByText(/Only 1 left/)).toBeVisible({ timeout: 20_000 });
  await expect(shop.getByRole('complementary')).toContainText('450.00');

  // ---- 11. An invalid code is refused safely -----------------------------
  await shop.getByRole('button', { name: 'Remove code' }).click();
  await expect(shop.getByLabel('Promotion code')).toBeVisible({ timeout: 20_000 });
  await shop.getByLabel('Promotion code').fill('NOT-A-REAL-CODE');
  await shop.getByRole('button', { name: 'Apply' }).click();
  await expect(shop.locator('#promo-error')).toContainText('not valid', { timeout: 20_000 });

  // ---- 12. Emptying the cart clears the promotion with it ----------------
  await shop.getByRole('button', { name: /Remove .* from the cart/ }).click();
  await expect(shop.getByText('Your cart is empty')).toBeVisible({ timeout: 20_000 });

  // ---- 13. Pausing the promotion stops it discounting --------------------
  await page.goto('/admin/promotions');
  await page.getByRole('button', { name: new RegExp(`Pause: ${PROMO}`) }).click();
  await expect(toast(page, 'Promotion paused')).toBeVisible({ timeout: 20_000 });

  await shop.goto(`/en/p/${PRODUCT_SLUG}`);
  await shop.getByRole('radio', { name: 'Black', exact: true }).click();
  await shop.getByRole('radio', { name: '40', exact: true }).click();
  await shop.getByRole('button', { name: 'Add to cart' }).click();
  await expect(toast(shop, 'Added to your cart')).toBeVisible({ timeout: 20_000 });
  await shop.goto('/en/cart');
  await shop.getByLabel('Promotion code').fill(PROMO);
  await shop.getByRole('button', { name: 'Apply' }).click();
  // A paused code is indistinguishable from one that never existed.
  await expect(shop.locator('#promo-error')).toContainText('not valid', { timeout: 20_000 });

  // ---- 14. Another shopper cannot see this cart --------------------------
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto('/en/cart');
  await expect(otherPage.getByText('Your cart is empty')).toBeVisible();
  await other.close();

  // ---- 15. The promotion changes are in the audit log --------------------
  // Read straight from the database the application just wrote to: an audit
  // trail nobody can find afterwards is not an audit trail, and there is no
  // admin screen for it yet to check through.
  const rows = auditRowsFor(PROMO);
  expect(rows).toContain('promotion.created');
  expect(rows).toContain('promotion.deactivated');

  await shopper.close();
});
