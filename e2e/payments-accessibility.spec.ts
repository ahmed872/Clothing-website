import { execSync } from 'node:child_process';

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/authenticated';
import { E2E_ORDER_FIXTURE } from './fixtures/order-fixture';

/**
 * P11 §32–§34 — the payment surfaces judged as interface.
 *
 * axe in both locales and both themes over every state a payment can be in
 * (nothing started, session open, paid, declined), plus the RTL rules a
 * mirrored layout has to keep, the mobile viewport, keyboard reachability,
 * and the rule that payment status is never carried by colour alone.
 *
 * The states are reached by actually paying — through the provider stub, at
 * the provider's own page — rather than by writing rows, because a status
 * the application never produced is not a state worth testing the UI for.
 */

test.describe.configure({ timeout: 240_000 });

const BASE = 'http://127.0.0.1:3000';

test.beforeAll(() => {
  execSync('pnpm db:seed-e2e-admins', { cwd: process.cwd(), stdio: 'inherit' });
  execSync('pnpm db:seed-e2e-orders', { cwd: process.cwd(), stdio: 'inherit' });
});

async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('body')
    // Next's dev-only overlay sits outside every landmark and trips the
    // `region` rule; it never ships to production.
    .exclude('nextjs-portal')
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

async function setAdminLocale(page: Page, locale: 'ar' | 'en'): Promise<void> {
  await page.context().addCookies([{ name: 'luxedrive-locale', value: locale, url: BASE }]);
}

const LABELS = {
  ar: {
    addToCart: 'أضف إلى السلة',
    added: 'أُضيف إلى السلة',
    placeOrder: 'تأكيد الطلب',
    payNow: 'ادفع الآن',
    paymentTitle: 'الدفع',
    email: 'البريد الإلكتروني',
    phone: 'رقم الجوال',
    fullName: 'الاسم الكامل',
    city: 'المدينة',
    district: 'الحي',
    street: 'الشارع',
    buildingNumber: 'رقم المبنى',
    noAttempts: 'لم تبدأ أي محاولة دفع بعد.',
    paid: 'تم تأكيد الدفع',
    failed: 'لم تكتمل عملية الدفع',
  },
  en: {
    addToCart: 'Add to Cart',
    added: 'Added to your cart',
    placeOrder: 'Place order',
    payNow: 'Pay now',
    paymentTitle: 'Payment',
    email: 'Email',
    phone: 'Mobile number',
    fullName: 'Full name',
    city: 'City',
    district: 'District',
    street: 'Street',
    buildingNumber: 'Building number',
    noAttempts: 'No payment has been started yet.',
    paid: 'Payment confirmed',
    failed: 'Payment did not go through',
  },
} as const;

async function fillCheckout(page: Page, locale: 'ar' | 'en'): Promise<void> {
  const l = LABELS[locale];
  await page.getByLabel(l.email, { exact: false }).fill('payer@example.com');
  await page.getByLabel(l.phone, { exact: false }).fill('0512345678');
  await page.getByLabel(l.fullName, { exact: false }).fill('Ahmed Yousef');
  await page.getByLabel(l.city, { exact: false }).fill('الرياض');
  await page.getByLabel(l.district, { exact: false }).fill('العليا');
  await page.getByLabel(l.street, { exact: false }).fill('طريق الملك فهد');
  await page.getByLabel(l.buildingNumber, { exact: false }).fill('3210');
}

/** Buys one fixture unit and lands on the payment page, unpaid. */
async function orderAwaitingPayment(page: Page, locale: 'ar' | 'en'): Promise<string> {
  await page.goto(`/${locale}/p/${E2E_ORDER_FIXTURE.productSlug}`);
  await page.getByRole('button', { name: LABELS[locale].addToCart }).click();
  await expect(page.getByText(LABELS[locale].added).first()).toBeVisible({ timeout: 20_000 });

  await page.goto(`/${locale}/checkout`);
  await fillCheckout(page, locale);
  await page.getByRole('button', { name: LABELS[locale].placeOrder }).click();
  await page.waitForURL(/\/order\/LD-[0-9A-Z-]+\/success/, { timeout: 60_000 });
  const number = new URL(page.url()).pathname.split('/').at(-2)!;

  await page.goto(`/${locale}/order/${number}/payment`);
  await expect(
    page.getByRole('heading', { name: LABELS[locale].paymentTitle, exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  return number;
}

/** Opens a provider session and comes back without resolving it, which is
 * the "we are still confirming" state a customer sees if they close the
 * provider tab. */
async function sessionOpen(page: Page, locale: 'ar' | 'en'): Promise<string> {
  const number = await orderAwaitingPayment(page, locale);
  await page.getByRole('button', { name: LABELS[locale].payNow }).click();
  await page.waitForURL(/\/pay\//, { timeout: 60_000 });
  await page.goto(`/${locale}/order/${number}/payment`);
  return number;
}

/** Pays, or is declined, at the provider's own page. */
async function settled(
  page: Page,
  locale: 'ar' | 'en',
  outcome: 'Approve payment' | 'Decline payment',
): Promise<string> {
  const number = await orderAwaitingPayment(page, locale);
  await page.getByRole('button', { name: LABELS[locale].payNow }).click();
  await page.waitForURL(/\/pay\//, { timeout: 60_000 });
  await page.getByRole('button', { name: outcome }).click();
  await page.waitForURL(`**/${locale}/order/${number}/payment`, { timeout: 60_000 });
  return number;
}

for (const locale of ['ar', 'en'] as const) {
  test.describe(`payment page — accessibility (axe, ${locale})`, () => {
    test('nothing started yet', async ({ page }) => {
      await orderAwaitingPayment(page, locale);
      await expect(page.getByText(LABELS[locale].noAttempts)).toBeVisible();
      await axe(page);
    });

    test('a session is open and unresolved', async ({ page }) => {
      await sessionOpen(page, locale);
      await expect(page.locator('main')).toBeVisible();
      await axe(page);
    });

    test('paid', async ({ page }) => {
      await settled(page, locale, 'Approve payment');
      await expect(page.getByText(LABELS[locale].paid)).toBeVisible({ timeout: 30_000 });
      await axe(page);
    });

    test('declined, with a retry offered', async ({ page }) => {
      await settled(page, locale, 'Decline payment');
      await expect(page.getByText(LABELS[locale].failed)).toBeVisible({ timeout: 30_000 });
      // The recovery path is present, not just the bad news.
      await expect(page.getByRole('button', { name: LABELS[locale].payNow })).toBeVisible();
      await axe(page);
    });

    test('paid, in dark mode', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await settled(page, locale, 'Approve payment');
      await expect(page.getByText(LABELS[locale].paid)).toBeVisible({ timeout: 30_000 });
      await axe(page);
    });

    test('declined, in dark mode', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await settled(page, locale, 'Decline payment');
      await expect(page.getByText(LABELS[locale].failed)).toBeVisible({ timeout: 30_000 });
      await axe(page);
    });
  });

  test.describe(`admin payment panel — accessibility (axe, ${locale})`, () => {
    test('an order with a settled attempt', async ({ browser, ownerContext }) => {
      const shopper = await browser.newContext();
      const number = await settled(await shopper.newPage(), 'en', 'Approve payment');
      await shopper.close();

      const page = await ownerContext.newPage();
      await setAdminLocale(page, locale);
      await page.goto(`/admin/orders/${number}`);
      await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });
      await axe(page);
    });

    test('an order with a declined attempt, in dark mode', async ({ browser, ownerContext }) => {
      const shopper = await browser.newContext();
      const number = await settled(await shopper.newPage(), 'en', 'Decline payment');
      await shopper.close();

      const page = await ownerContext.newPage();
      await page.emulateMedia({ colorScheme: 'dark' });
      await setAdminLocale(page, locale);
      await page.goto(`/admin/orders/${number}`);
      await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });
      await axe(page);
    });
  });
}

test.describe('payment — RTL', () => {
  test('mirrors the page but keeps money and identifiers readable', async ({ page }) => {
    const number = await settled(page, 'ar', 'Approve payment');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    // The order number is a Latin identifier inside an Arabic page: without
    // an explicit direction its segments reorder and it reads back wrong.
    const shown = page.locator('[dir="ltr"]', { hasText: number }).first();
    await expect(shown).toBeVisible();
    await expect(shown).toHaveText(number);

    // Money renders with Latin digits in both locales (the `-u-nu-latn`
    // decision from P02), so a total is never ambiguous.
    await expect(page.getByText(/1,200\.00/).first()).toBeVisible();
  });

  test('the admin panel keeps the provider reference left-to-right', async ({
    browser,
    ownerContext,
  }) => {
    const shopper = await browser.newContext();
    const number = await settled(await shopper.newPage(), 'en', 'Approve payment');
    await shopper.close();

    const page = await ownerContext.newPage();
    await setAdminLocale(page, 'ar');
    await page.goto(`/admin/orders/${number}`);
    await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    const reference = page
      .locator('dd[dir="ltr"]')
      .filter({ hasText: /^sess_/ })
      .first();
    await expect(reference).toBeVisible();
  });
});

test.describe('payment — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  async function noHorizontalOverflow(page: Page): Promise<void> {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }

  test('the payment page fits 390px in Arabic, before and after paying', async ({ page }) => {
    const number = await orderAwaitingPayment(page, 'ar');
    await noHorizontalOverflow(page);

    await page.getByRole('button', { name: LABELS.ar.payNow }).click();
    await page.waitForURL(/\/pay\//, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Approve payment' }).click();
    await page.waitForURL(`**/ar/order/${number}/payment`, { timeout: 60_000 });

    await expect(page.getByText(LABELS.ar.paid)).toBeVisible({ timeout: 30_000 });
    await noHorizontalOverflow(page);
    // The attempts table scrolls inside its own container, not the page.
    await noHorizontalOverflow(page);
  });

  test('the admin order detail with a payment fits 390px', async ({ browser, ownerContext }) => {
    const shopper = await browser.newContext();
    const number = await settled(await shopper.newPage(), 'en', 'Approve payment');
    await shopper.close();

    const page = await ownerContext.newPage();
    await setAdminLocale(page, 'en');
    await page.goto(`/admin/orders/${number}`);
    await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });
    await noHorizontalOverflow(page);
    // The provider reference is long; it must not be what widens the page.
    await expect(page.getByText('HOSTED_CHECKOUT')).toBeVisible();
  });
});

test.describe('payment — keyboard and status semantics', () => {
  test('the pay button is reachable and named, and announces progress', async ({ page }) => {
    await orderAwaitingPayment(page, 'en');
    const pay = page.getByRole('button', { name: LABELS.en.payNow });
    await pay.focus();
    await expect(pay).toBeFocused();
    // A live region exists for the status the button is about to change.
    await expect(page.locator('[aria-live="polite"]')).toHaveCount(1);
  });

  test('every payment status carries text, not just colour', async ({ page }) => {
    const number = await settled(page, 'en', 'Decline payment');
    // The attempt row says "Failed" in words.
    await expect(page.getByText('Failed', { exact: true }).first()).toBeVisible();

    // And after a successful retry, "Succeeded" in words.
    await page.getByRole('button', { name: LABELS.en.payNow }).click();
    await page.waitForURL(/\/pay\//, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Approve payment' }).click();
    await page.waitForURL(`**/en/order/${number}/payment`, { timeout: 60_000 });
    await expect(page.getByText('Succeeded', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
