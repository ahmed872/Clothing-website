import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { E2E_ACCEPTANCE_OWNER } from './fixtures/admin-credentials';

/**
 * P11 §29 — the critical payment lifecycle, on the same generic commerce
 * scenario the earlier phases used.
 *
 *   a store owner publishes Running Shoes with Colour × Size variants, sets
 *   the last unit of one in stock and creates a promotion → a guest buys it
 *   → the payment session carries the order's total and nothing else → the
 *   page is tampered with and changes nothing → the customer pays at the
 *   provider → a *verified* webhook is what marks it paid, and the return
 *   page proves nothing on its own → the webhook is replayed, delivered
 *   forged, delivered stale, and delivered concurrently, and none of it
 *   moves anything → stock is still 0 and the coupon still redeemed once →
 *   a declined payment can be retried → a stranger cannot see any of it →
 *   the admin sees the attempts and is offered no way to move money.
 *
 * One long serial test on purpose: the claim is that the whole path holds
 * together, and a step that only passed because an earlier test left the
 * right state behind would not prove that.
 *
 * The provider is `scripts/payment-provider-stub.mjs` — a stand-in for the
 * vendor, not for us. Its webhooks are signed with the real
 * `PAYMENT_WEBHOOK_SECRET` using the real HMAC construction, and this
 * application verifies them with its own production code. No vendor sandbox
 * was reachable from this environment; everything below the vendor's wire
 * format is exercised for real.
 */

const RUN = Date.now().toString().slice(-6);
const CATEGORY_EN = `Footwear P11 ${RUN}`;
const PRODUCT_EN = `Running Shoes P11 ${RUN}`;
const PRODUCT_SLUG = `running-shoes-p11-${RUN}`;
const SKU_BASE = `RUNP11-${RUN}`;
const PROMO = `PAY${RUN}`;
const VARIANT = 'Black / 40';
const STUB = 'http://127.0.0.1:4011';

test.describe.configure({ mode: 'serial', timeout: 600_000 });

test.beforeAll(() => {
  execSync('pnpm db:seed-e2e-admins', { cwd: process.cwd(), stdio: 'inherit' });
});

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

function toast(page: Page, text: string | RegExp) {
  return page.getByText(text).first();
}

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

async function fillCheckout(page: Page): Promise<void> {
  await page.getByLabel('Email').fill('payer@example.com');
  await page.getByLabel('Mobile number').fill('0512345678');
  await page.getByLabel('Full name').fill('Ahmed Yousef');
  await page.getByLabel('City').fill('Riyadh');
  await page.getByLabel('District').fill('Al Olaya');
  await page.getByLabel('Street').fill('King Fahd Road');
  await page.getByLabel('Building number').fill('3210');
}

/** Deliveries a browser cannot produce: replays, stale events, forgeries.
 * Driven through the stub so they travel the same HTTP path a real
 * provider's would. */
async function deliver(
  page: Page,
  payload: Record<string, unknown>,
): Promise<{ delivered: number }> {
  return page.evaluate(
    async ([url, body]) => {
      const response = await fetch(`${url}/__test/deliver`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return (await response.json()) as { delivered: number };
    },
    [STUB, payload] as const,
  );
}

test('an order is paid only by a verified provider event, exactly once', async ({
  page,
  browser,
}) => {
  test.slow();
  await signInAsOwner(page);

  // ---- 1–2. Category, product, Colour × Size variants, published ---------
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

  // ---- 3. Exactly one unit, priced at 400.00 -----------------------------
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

  // ---- 4. A 10% promotion ------------------------------------------------
  await page.goto('/admin/promotions/new');
  await page.getByLabel('Promotion code').fill(PROMO);
  await page.getByLabel('Percentage (%)').fill('10');
  await page.getByLabel('Starts').fill('2020-01-01');
  await page.getByLabel('Ends').fill('2099-12-31');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL('**/admin/promotions', { timeout: 30_000 });

  // ---- 5–7. A guest checks out through P10 -------------------------------
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

  await shop.getByRole('link', { name: 'Checkout' }).click();
  await shop.waitForURL('**/en/checkout');
  await fillCheckout(shop);
  await shop.getByRole('button', { name: 'Place order' }).click();
  await shop.waitForURL(/\/en\/order\/LD-\d{6}-[0-9A-HJKMNP-TV-Z]{6}\/success/, {
    timeout: 60_000,
  });
  const orderNumber = shop.url().match(/order\/(LD-\d{6}-[0-9A-HJKMNP-TV-Z]{6})/)![1]!;

  // Exactly one order, at the server's total: 400.00 − 10% = 360.00.
  expect(sql(`select count(*) from orders where number = '${orderNumber}'`)).toBe('1');
  expect(sql(`select total_minor from orders where number = '${orderNumber}'`)).toBe('36000');
  expect(sql(`select payment_status from orders where number = '${orderNumber}'`)).toBe('UNPAID');

  // ---- 8. The success page offers payment, and says it is not paid -------
  await expect(shop.getByRole('link', { name: 'Pay now' })).toBeVisible();
  await shop.getByRole('link', { name: 'Pay now' }).click();
  await shop.waitForURL(`**/en/order/${orderNumber}/payment`);
  await expect(shop.getByRole('heading', { name: 'Payment', exact: true })).toBeVisible();
  await expect(shop.getByText('360.00')).toBeVisible();
  await expect(shop.getByText('No payment has been started yet.')).toBeVisible();

  // ---- 9–14. Tampering, then a real session ------------------------------
  // Rewrite every figure on the page before pressing Pay.
  await shop.evaluate(() => {
    document.querySelectorAll('span, dd, td').forEach((element) => {
      if (/\d/.test(element.textContent ?? '')) element.textContent = '0.01';
    });
  });
  await expect(shop.getByText('0.01').first()).toBeVisible();

  await shop.getByRole('button', { name: 'Pay now' }).click();
  await shop.waitForURL(new RegExp(`${STUB.replace(/[.*+?^$()|[\\]\\\\]/g, '\\\\$&')}/pay/`), {
    timeout: 60_000,
  });

  // The provider was asked for the order's total, not the tampered figure.
  expect(
    sql(
      `select amount_minor from payments p join orders o on o.id = p.order_id where o.number = '${orderNumber}'`,
    ),
  ).toBe('36000');
  expect(
    sql(
      `select p.currency from payments p join orders o on o.id = p.order_id where o.number = '${orderNumber}'`,
    ),
  ).toBe('SAR');
  expect(await shop.locator('#amount').innerText()).toBe('36000');

  const sessionId = shop.url().split('/pay/')[1]!;

  // The order is PENDING while the session is open — not paid.
  expect(sql(`select payment_status from orders where number = '${orderNumber}'`)).toBe('PENDING');

  // ---- 15. A forged and an unsigned delivery change nothing --------------
  const control = await browser.newContext();
  const ctl = await control.newPage();
  await ctl.goto(`${STUB}/__test/health`);

  await deliver(ctl, {
    sessionId,
    eventId: `evt_forged_${RUN}`,
    status: 'paid',
    forgeSignature: true,
  });
  await deliver(ctl, {
    sessionId,
    eventId: `evt_unsigned_${RUN}`,
    status: 'paid',
    omitSignature: true,
  });

  expect(sql(`select payment_status from orders where number = '${orderNumber}'`)).toBe('PENDING');
  expect(
    sql(
      `select count(*) from payments p join orders o on o.id = p.order_id where o.number = '${orderNumber}' and p.status = 'SUCCEEDED'`,
    ),
  ).toBe('0');
  // Both rejections are on the record, attached to no payment.
  expect(
    sql(`select count(*) from webhook_events where signature_valid = false and status = 'FAILED'`),
  ).not.toBe('0');

  // ---- 16–17. The customer pays, and a verified webhook is what counts ---
  await shop.getByRole('button', { name: 'Approve payment' }).click();
  await shop.waitForURL(`**/en/order/${orderNumber}/payment`, { timeout: 60_000 });

  // The return itself carried no proof — no status in the query string.
  expect(new URL(shop.url()).search).toBe('');

  expect(sql(`select payment_status from orders where number = '${orderNumber}'`)).toBe('PAID');
  // Money arriving is what confirms an order.
  expect(sql(`select status from orders where number = '${orderNumber}'`)).toBe('CONFIRMED');
  expect(
    sql(
      `select p.status from payments p join orders o on o.id = p.order_id where o.number = '${orderNumber}'`,
    ),
  ).toBe('SUCCEEDED');

  await shop.reload();
  await expect(shop.getByText('Payment confirmed')).toBeVisible({ timeout: 30_000 });

  // ---- 18–19. Nothing was taken or consumed twice ------------------------
  expect(sql(`select stock_quantity from variants where sku = '${sku}'`)).toBe('0');
  expect(
    sql(
      `select count(*) from inventory_adjustments a join variants v on v.id = a.variant_id where v.sku = '${sku}' and a.reason = 'SALE'`,
    ),
  ).toBe('1');
  expect(
    sql(
      `select count(*) from coupon_redemptions r join orders o on o.id = r.order_id where o.number = '${orderNumber}'`,
    ),
  ).toBe('1');
  expect(sql(`select count(*) from orders where number = '${orderNumber}'`)).toBe('1');

  // ---- 20–21. Replay the successful event --------------------------------
  const paidEventId = sql(
    `select external_event_id from webhook_events w join payments p on p.id = w.payment_id join orders o on o.id = p.order_id where o.number = '${orderNumber}' and w.status = 'PROCESSED' order by w.created_at desc limit 1`,
  );
  expect(paidEventId).not.toBe('');

  await deliver(ctl, { sessionId, eventId: paidEventId, status: 'paid' });
  await deliver(ctl, { sessionId, eventId: paidEventId, status: 'paid' });

  // One row, one transition, one confirmation, one of everything else.
  expect(
    sql(`select count(*) from webhook_events where external_event_id = '${paidEventId}'`),
  ).toBe('1');
  expect(
    sql(
      `select count(*) from order_events e join orders o on o.id = e.order_id where o.number = '${orderNumber}' and e.type = 'PAYMENT_STATUS' and e.to_value = 'PAID'`,
    ),
  ).toBe('1');
  expect(sql(`select stock_quantity from variants where sku = '${sku}'`)).toBe('0');
  expect(
    sql(
      `select count(*) from coupon_redemptions r join orders o on o.id = r.order_id where o.number = '${orderNumber}'`,
    ),
  ).toBe('1');

  // ---- 22. A stale event cannot walk it backwards ------------------------
  await deliver(ctl, {
    sessionId,
    eventId: `evt_stale_${RUN}`,
    status: 'pending',
    occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
  });
  expect(sql(`select payment_status from orders where number = '${orderNumber}'`)).toBe('PAID');

  // ---- 23. Concurrent duplicate delivery ---------------------------------
  const concurrentId = `evt_concurrent_${RUN}`;
  await ctl.evaluate(
    async ([url, id, session]) => {
      const body = { sessionId: session, eventId: id, status: 'paid' };
      await Promise.all(
        Array.from({ length: 4 }, () =>
          fetch(`${url}/__test/deliver`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
        ),
      );
    },
    [STUB, concurrentId, sessionId] as const,
  );
  expect(
    sql(`select count(*) from webhook_events where external_event_id = '${concurrentId}'`),
  ).toBe('1');
  expect(sql(`select payment_status from orders where number = '${orderNumber}'`)).toBe('PAID');

  // ---- 24. Paying again is refused ---------------------------------------
  await shop.goto(`/en/order/${orderNumber}/payment`);
  await expect(shop.getByRole('button', { name: 'Pay now' })).toHaveCount(0);

  // ---- 25–26. A stranger sees none of it ---------------------------------
  const stranger = await browser.newContext();
  const nosy = await stranger.newPage();
  expect((await nosy.goto(`/en/order/${orderNumber}/payment`))?.status()).toBe(404);
  expect((await nosy.goto(`/en/order/${orderNumber}/success`))?.status()).toBe(404);
  await stranger.close();

  // ---- 27–28. The admin sees the attempt, and no way to move money -------
  await page.goto(`/admin/orders/${orderNumber}`);
  await expect(page.getByText('HOSTED_CHECKOUT')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(sessionId)).toBeVisible();
  await expect(page.getByText('Refunds are not wired up yet')).toBeVisible();
  // No button anywhere marks money paid or refunded.
  await expect(page.getByRole('button', { name: /paid/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /refund/i })).toHaveCount(0);

  // ---- 29–30. Arabic and English -----------------------------------------
  await shop.goto(`/ar/order/${orderNumber}/payment`);
  await expect(shop.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(shop.getByText('تم تأكيد الدفع')).toBeVisible({ timeout: 30_000 });
  // The Latin session reference still reads left to right inside an RTL page.
  await expect(shop.locator('[dir="ltr"]', { hasText: orderNumber }).first()).toHaveText(
    orderNumber,
  );

  await shop.goto(`/en/order/${orderNumber}/payment`);
  await expect(shop.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(shop.getByText('Payment confirmed')).toBeVisible();

  await control.close();
  await shopper.close();
});

/**
 * A declined payment, and the retry that follows it (P11 §16/§17).
 *
 * Separate from the journey above because it needs its own order: the point
 * is that a failure leaves a record and does not block a second attempt, and
 * that requires an order nothing has succeeded on.
 */
test('a declined payment can be retried, and both attempts survive', async ({ browser }) => {
  test.slow();
  execSync('pnpm db:seed-e2e-orders', { cwd: process.cwd(), stdio: 'inherit' });

  const shopper = await browser.newContext();
  const shop = await shopper.newPage();

  await shop.goto('/en/p/e2e-order-fixture');
  await shop.getByRole('button', { name: 'Add to cart' }).click();
  await expect(toast(shop, 'Added to your cart')).toBeVisible({ timeout: 20_000 });

  await shop.goto('/en/checkout');
  await fillCheckout(shop);
  await shop.getByRole('button', { name: 'Place order' }).click();
  await shop.waitForURL(/\/en\/order\/LD-\d{6}-[0-9A-HJKMNP-TV-Z]{6}\/success/, {
    timeout: 60_000,
  });
  const orderNumber = shop.url().match(/order\/(LD-\d{6}-[0-9A-HJKMNP-TV-Z]{6})/)![1]!;

  // First attempt: declined at the provider.
  await shop.goto(`/en/order/${orderNumber}/payment`);
  await shop.getByRole('button', { name: 'Pay now' }).click();
  await shop.waitForURL(/\/pay\//, { timeout: 60_000 });
  await shop.getByRole('button', { name: 'Decline payment' }).click();
  await shop.waitForURL(`**/en/order/${orderNumber}/payment`, { timeout: 60_000 });

  expect(sql(`select payment_status from orders where number = '${orderNumber}'`)).toBe('FAILED');
  expect(
    sql(
      `select p.failure_code from payments p join orders o on o.id = p.order_id where o.number = '${orderNumber}'`,
    ),
  ).toBe('card_declined');
  await expect(shop.getByText('Payment did not go through')).toBeVisible({ timeout: 30_000 });

  // Second attempt: approved.
  await shop.reload();
  await shop.getByRole('button', { name: 'Pay now' }).click();
  await shop.waitForURL(/\/pay\//, { timeout: 60_000 });
  await shop.getByRole('button', { name: 'Approve payment' }).click();
  await shop.waitForURL(`**/en/order/${orderNumber}/payment`, { timeout: 60_000 });

  expect(sql(`select payment_status from orders where number = '${orderNumber}'`)).toBe('PAID');
  expect(sql(`select status from orders where number = '${orderNumber}'`)).toBe('CONFIRMED');

  // Both attempts are still on the record — the decline was not overwritten.
  expect(
    sql(
      `select count(*) from payments p join orders o on o.id = p.order_id where o.number = '${orderNumber}'`,
    ),
  ).toBe('2');
  expect(
    sql(
      `select count(*) from payments p join orders o on o.id = p.order_id where o.number = '${orderNumber}' and p.status = 'FAILED'`,
    ),
  ).toBe('1');
  expect(
    sql(
      `select count(*) from payments p join orders o on o.id = p.order_id where o.number = '${orderNumber}' and p.status = 'SUCCEEDED'`,
    ),
  ).toBe('1');
  // And still exactly one order.
  expect(sql(`select count(*) from orders where number = '${orderNumber}'`)).toBe('1');

  await shopper.close();
});
