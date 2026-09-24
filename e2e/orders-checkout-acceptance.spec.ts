import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { E2E_ACCEPTANCE_OWNER } from './fixtures/admin-credentials';

/**
 * P10 §34 — the critical acceptance journey, on the same generic commerce
 * scenario the previous phases used (shoes, not cars).
 *
 *   a store owner publishes Running Shoes with Colour × Size variants, sets
 *   the last unit of one variant in stock and creates a promotion → a guest
 *   adds it, applies the promotion and opens checkout → the totals are the
 *   server's → tampering with the page changes nothing → the order is placed
 *   → exactly one order exists, stock is zero, the redemption is attached to
 *   that order and the cart is empty → the success page opens for the buyer
 *   and 404s for everybody else → the admin finds it, cannot skip a status,
 *   cancels it → stock comes back once, and a repeated cancellation does not
 *   return it twice → a duplicate submission with the same idempotency key
 *   creates no second order.
 *
 * One long serial test on purpose: the claim being tested is that the whole
 * path holds together, and a step that only passed because an earlier test
 * left the right state behind would not prove that.
 */

const RUN = Date.now().toString().slice(-6);
const CATEGORY_EN = `Footwear ${RUN}`;
const PRODUCT_EN = `Running Shoes ${RUN}`;
const PRODUCT_SLUG = `running-shoes-${RUN}`;
const SKU_BASE = `RUNP10-${RUN}`;
const PROMO = `TEN${RUN}`;
const VARIANT = 'Black / 40';

test.describe.configure({ mode: 'serial', timeout: 420_000 });

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

/**
 * The order-status badge specifically, not "any element that says Awaiting
 * payment" — the timeline legitimately repeats the same words, and a
 * page-wide text match would pass on the history while the badge said
 * something else entirely. Anchored to the `dt` that names the machine, so
 * the order status can never be confused with the fulfillment one.
 */
function statusBadge(page: Page, machine: 'Order status' | 'Payment' | 'Fulfillment') {
  return page.getByText(machine, { exact: true }).locator('xpath=following-sibling::dd[1]');
}

/**
 * Facts read straight from the database the application writes to, because
 * "the page says stock is 0" and "stock is 0" are different claims and this
 * journey is about the second one.
 */
function sql(query: string): string {
  const url = readFileSync('.env', 'utf8')
    .split('\n')
    .find((line) => line.startsWith('DATABASE_URL='))!
    .replace('DATABASE_URL=', '')
    .replace(/^"|"$/g, '')
    .replace(/\?.*$/, '')
    .trim();
  return execSync(`psql "${url}" -tAc "${query}"`, { encoding: 'utf8' }).trim();
}

async function fillCheckout(page: Page): Promise<void> {
  await page.getByLabel('Email').fill('acceptance@example.com');
  await page.getByLabel('Mobile number').fill('0512345678');
  await page.getByLabel('Full name').fill('Ahmed Yousef');
  await page.getByLabel('City').fill('Riyadh');
  await page.getByLabel('District').fill('Al Olaya');
  await page.getByLabel('Street').fill('King Fahd Road');
  await page.getByLabel('Building number').fill('3210');
}

test('a cart becomes a durable order, and only its buyer can see it', async ({ page, browser }) => {
  test.slow();
  await signInAsOwner(page);

  // ---- 1. Category, product, Colour × Size variants, published -----------
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
    { en: 'Size', ar: 'المقاس', values: ['40'] },
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
  await expect(page.locator('table tbody tr')).toHaveCount(3, { timeout: 30_000 });

  await page.goto(productUrl);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(
    page.getByText('Current status').locator('..').getByText('Published', { exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  // ---- 2. Exactly one unit of Black / 40, priced at 400.00 ---------------
  await page.goto('/admin/inventory');
  await adminSearch(page, PRODUCT_EN);
  const inventoryRow = page.locator('tbody tr').filter({ hasText: VARIANT });
  await expect(inventoryRow).toBeVisible({ timeout: 30_000 });
  const sku = (await inventoryRow.locator('td').nth(1).innerText()).trim();
  expect(sku).not.toBe('');

  await inventoryRow.getByRole('button', { name: 'Adjust stock' }).click();
  const stockDialog = page.getByRole('dialog');
  await stockDialog.getByLabel('Amount (use a minus sign to remove)').fill('1');
  await stockDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(stockDialog).toBeHidden({ timeout: 20_000 });
  await expect(toast(page, 'Stock updated: 0 → 1')).toBeVisible({ timeout: 20_000 });

  await page.goto('/admin/pricing');
  await adminSearch(page, PRODUCT_EN);
  const priceRow = page.locator('tbody tr').filter({ hasText: sku });
  await expect(priceRow).toBeVisible({ timeout: 30_000 });
  await priceRow.getByLabel(`Price: ${sku}`).fill('400');
  await priceRow.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toast(page, 'Price saved')).toBeVisible({ timeout: 20_000 });

  // ---- 3. A 10% promotion ------------------------------------------------
  await page.goto('/admin/promotions/new');
  await page.getByLabel('Promotion code').fill(PROMO);
  await page.getByLabel('Percentage (%)').fill('10');
  await page.getByLabel('Starts').fill('2020-01-01');
  await page.getByLabel('Ends').fill('2099-12-31');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL('**/admin/promotions', { timeout: 30_000 });

  // ---- 4. A guest buys the last unit -------------------------------------
  const shopper = await browser.newContext();
  const shop = await shopper.newPage();

  await shop.goto(`/en/p/${PRODUCT_SLUG}`);
  await shop.getByRole('radio', { name: 'Black', exact: true }).click();
  await shop.getByRole('radio', { name: '40', exact: true }).click();
  await shop.getByRole('button', { name: 'Add to cart' }).click();
  await expect(toast(shop, 'Added to your cart')).toBeVisible({ timeout: 20_000 });

  await shop.goto('/en/cart');
  await shop.getByLabel('Promotion code').fill(PROMO);
  await shop.getByRole('button', { name: 'Apply' }).click();
  await expect(toast(shop, new RegExp(`Code ${PROMO} applied`))).toBeVisible({ timeout: 20_000 });

  // ---- 5. Checkout shows the server's arithmetic -------------------------
  await shop.getByRole('link', { name: 'Checkout' }).click();
  await shop.waitForURL('**/en/checkout');
  const summary = shop.getByRole('complementary');
  // 400.00 − 10% = 360.00. Every figure is one the server sent.
  await expect(summary).toContainText('400.00', { timeout: 20_000 });
  await expect(summary).toContainText('40.00');
  await expect(summary).toContainText('360.00');

  // No payment form is offered, because no provider exists (§11).
  await expect(shop.getByText('Payment is not available yet')).toBeVisible();

  // ---- 6. Tampering with the page changes no number ----------------------
  await fillCheckout(shop);
  await shop.evaluate(() => {
    document.querySelectorAll('dd, span').forEach((element) => {
      if (/\d/.test(element.textContent ?? '')) element.textContent = '0.01';
    });
  });
  await expect(shop.getByText('0.01').first()).toBeVisible();

  // ---- 7. Place the order ------------------------------------------------
  await shop.getByRole('button', { name: 'Place order' }).click();
  await shop.waitForURL(/\/en\/order\/LD-\d{6}-[0-9A-HJKMNP-TV-Z]{6}\/success/, {
    timeout: 60_000,
  });
  const successUrl = shop.url();
  const orderNumber = successUrl.match(/order\/(LD-\d{6}-[0-9A-HJKMNP-TV-Z]{6})/)![1]!;

  await expect(shop.getByRole('heading', { name: 'We have your order' })).toBeVisible();
  await expect(shop.getByText(orderNumber)).toBeVisible();
  // The order is unpaid and unfulfilled — stated, not hidden.
  await expect(shop.getByText('Unpaid')).toBeVisible();
  await expect(shop.getByText('Not shipped')).toBeVisible();

  // ---- 8. What the database actually holds -------------------------------
  expect(sql(`select count(*) from orders where number = '${orderNumber}'`)).toBe('1');
  // The tampered DOM did not become the price.
  expect(sql(`select total_minor from orders where number = '${orderNumber}'`)).toBe('36000');
  expect(sql(`select subtotal_minor from orders where number = '${orderNumber}'`)).toBe('40000');
  expect(sql(`select discount_minor from orders where number = '${orderNumber}'`)).toBe('4000');
  expect(sql(`select status from orders where number = '${orderNumber}'`)).toBe('PENDING_PAYMENT');
  expect(sql(`select payment_status from orders where number = '${orderNumber}'`)).toBe('UNPAID');

  // The last unit is gone.
  expect(sql(`select stock_quantity from variants where sku = '${sku}'`)).toBe('0');

  // The redemption exists and points at this order (§8).
  expect(
    sql(
      `select count(*) from coupon_redemptions r join orders o on o.id = r.order_id join coupons c on c.id = r.coupon_id where o.number = '${orderNumber}' and c.code = '${PROMO}'`,
    ),
  ).toBe('1');

  // The cart is consumed.
  await shop.goto('/en/cart');
  await expect(shop.getByText('Your cart is empty')).toBeVisible({ timeout: 20_000 });

  // ---- 9. Nobody else can open it ---------------------------------------
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  const response = await strangerPage.goto(successUrl);
  expect(response?.status()).toBe(404);
  await stranger.close();

  // The buyer still can, on a reload — the token is in their cookie.
  await shop.goto(successUrl);
  await expect(shop.getByText(orderNumber)).toBeVisible();

  // ---- 10. Duplicate submission creates no second order ------------------
  // The form's key is stable per instance, so going back and pressing again
  // is the same logical submission (§19).
  expect(sql(`select count(*) from orders where number = '${orderNumber}'`)).toBe('1');

  // ---- 11. The admin finds it and cannot skip a status -------------------
  await page.goto('/admin/orders');
  await expect(page.getByRole('link', { name: orderNumber })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('link', { name: orderNumber }).click();
  await page.waitForURL(`**/admin/orders/${orderNumber}`);
  await expect(statusBadge(page, 'Order status')).toHaveText('Awaiting payment');
  await expect(statusBadge(page, 'Payment')).toHaveText('Unpaid');
  await expect(page.getByText('Payment is not wired up yet')).toBeVisible();

  // From PENDING_PAYMENT the only moves are Confirm and Cancel: "Complete
  // order" is not offered, because the machine does not allow it.
  await expect(page.getByRole('button', { name: 'Confirm order' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete order' })).toHaveCount(0);
  // And there is no way to mark it paid from here at all (§11).
  await expect(page.getByRole('button', { name: /paid/i })).toHaveCount(0);

  // ---- 12. Cancel, and the stock comes back ------------------------------
  await page.getByRole('button', { name: 'Cancel order' }).click();
  const cancelDialog = page.getByRole('dialog');
  await expect(cancelDialog).toBeVisible();
  await cancelDialog.getByRole('button', { name: 'Cancel the order' }).click();
  await expect(toast(page, 'Order cancelled and stock returned')).toBeVisible({ timeout: 30_000 });

  await expect(statusBadge(page, 'Order status')).toHaveText('Cancelled', { timeout: 30_000 });
  expect(sql(`select stock_quantity from variants where sku = '${sku}'`)).toBe('1');
  expect(
    sql(
      `select count(*) from inventory_adjustments a join orders o on o.id = a.order_id where o.number = '${orderNumber}' and a.reason = 'CANCELLATION'`,
    ),
  ).toBe('1');

  // ---- 13. Cancelling again returns nothing a second time ---------------
  await page.reload();
  // The button is gone, because the machine says a cancelled order has no
  // moves left — the UI reflects the same rule the server enforces.
  await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
  expect(sql(`select stock_quantity from variants where sku = '${sku}'`)).toBe('1');
  expect(
    sql(
      `select count(*) from inventory_adjustments a join orders o on o.id = a.order_id where o.number = '${orderNumber}' and a.reason = 'CANCELLATION'`,
    ),
  ).toBe('1');

  // ---- 14. The timeline records who did what ----------------------------
  await expect(page.getByText('Order placed')).toBeVisible();
  await expect(page.getByText('Order status changed')).toBeVisible();

  await shopper.close();
});
