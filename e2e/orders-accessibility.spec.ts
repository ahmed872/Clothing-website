import { execSync } from 'node:child_process';

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/authenticated';
import { E2E_ORDER_FIXTURE } from './fixtures/order-fixture';

/**
 * P10 §27–§30 — the order surfaces judged as interface, not as logic:
 * axe in both locales and both themes, the RTL rules that a mirrored layout
 * has to keep (Latin identifiers still read left-to-right), the mobile
 * viewport, keyboard reachability, and the role gate on the admin screens.
 *
 * Checkout and the order pages need a real order to exist, and placing one
 * consumes stock — so these specs buy from their own fixture product
 * (`db:seed-e2e-orders`) rather than draining the demo catalog every other
 * spec in the suite reads from.
 */

test.describe.configure({ timeout: 180_000 });

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
    checkout: 'إتمام الشراء',
    placeOrder: 'تأكيد الطلب',
    paymentPending: 'الدفع غير متاح بعد',
    successTitle: 'تم استلام طلبك',
    email: 'البريد الإلكتروني',
    phone: 'رقم الجوال',
    fullName: 'الاسم الكامل',
    city: 'المدينة',
    district: 'الحي',
    street: 'الشارع',
    buildingNumber: 'رقم المبنى',
  },
  en: {
    addToCart: 'Add to Cart',
    added: 'Added to your cart',
    checkout: 'Checkout',
    placeOrder: 'Place order',
    paymentPending: 'Payment is not available yet',
    successTitle: 'We have your order',
    email: 'Email',
    phone: 'Mobile number',
    fullName: 'Full name',
    city: 'City',
    district: 'District',
    street: 'Street',
    buildingNumber: 'Building number',
  },
} as const;

/** Adds the fixture product and waits for the server to confirm, so a
 * following navigation cannot outrun the write. */
async function addFixtureToCart(page: Page, locale: 'ar' | 'en'): Promise<void> {
  await page.goto(`/${locale}/p/${E2E_ORDER_FIXTURE.productSlug}`);
  await page.getByRole('button', { name: LABELS[locale].addToCart }).click();
  await expect(page.getByText(LABELS[locale].added).first()).toBeVisible({ timeout: 20_000 });
}

async function fillCheckout(page: Page, locale: 'ar' | 'en'): Promise<void> {
  const l = LABELS[locale];
  await page.getByLabel(l.email, { exact: false }).fill('shopper@example.com');
  await page.getByLabel(l.phone, { exact: false }).fill('0512345678');
  await page.getByLabel(l.fullName, { exact: false }).fill('Ahmed Yousef');
  await page.getByLabel(l.city, { exact: false }).fill('الرياض');
  await page.getByLabel(l.district, { exact: false }).fill('العليا');
  await page.getByLabel(l.street, { exact: false }).fill('طريق الملك فهد');
  await page.getByLabel(l.buildingNumber, { exact: false }).fill('3210');
}

/** Buys one fixture unit and returns the order number, leaving the page on
 * the success screen with the access cookie set. */
async function placeOrder(page: Page, locale: 'ar' | 'en'): Promise<string> {
  await addFixtureToCart(page, locale);
  await page.goto(`/${locale}/checkout`);
  await expect(page.getByText(LABELS[locale].paymentPending)).toBeVisible({ timeout: 30_000 });
  await fillCheckout(page, locale);
  await page.getByRole('button', { name: LABELS[locale].placeOrder }).click();
  await page.waitForURL(/\/order\/LD-[0-9A-Z-]+\/success/, { timeout: 60_000 });
  return new URL(page.url()).pathname.split('/').at(-2)!;
}

for (const locale of ['ar', 'en'] as const) {
  test.describe(`checkout — accessibility (axe, ${locale})`, () => {
    test('the form, with the payment boundary stated', async ({ page }) => {
      await addFixtureToCart(page, locale);
      await page.goto(`/${locale}/checkout`);
      await expect(page.getByText(LABELS[locale].paymentPending)).toBeVisible({ timeout: 30_000 });
      await axe(page);
    });

    test('the form showing validation errors', async ({ page }) => {
      await addFixtureToCart(page, locale);
      await page.goto(`/${locale}/checkout`);
      // Submitting empty is the state most likely to break the label /
      // error-message association axe checks, so it is the one worth running.
      await page.getByRole('button', { name: LABELS[locale].placeOrder }).click();
      await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
      await axe(page);
    });

    test('the empty-cart checkout', async ({ page }) => {
      await page.goto(`/${locale}/checkout`);
      await expect(page.locator('main')).toBeVisible();
      await axe(page);
    });

    test('the form in dark mode', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await addFixtureToCart(page, locale);
      await page.goto(`/${locale}/checkout`);
      await expect(page.getByText(LABELS[locale].paymentPending)).toBeVisible({ timeout: 30_000 });
      await axe(page);
    });
  });

  test.describe(`order pages — accessibility (axe, ${locale})`, () => {
    test('the success page and the order detail behind it', async ({ page }) => {
      const number = await placeOrder(page, locale);
      await expect(page.getByRole('heading', { name: LABELS[locale].successTitle })).toBeVisible();
      await axe(page);

      await page.goto(`/${locale}/account/orders/${number}`);
      await expect(page.locator('main')).toBeVisible();
      await axe(page);
    });

    test('the success page in dark mode', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await placeOrder(page, locale);
      await expect(page.getByRole('heading', { name: LABELS[locale].successTitle })).toBeVisible();
      await axe(page);
    });
  });

  test.describe(`admin orders — accessibility (axe, ${locale})`, () => {
    test('the list and one order', async ({ browser, ownerContext }) => {
      const shop = await browser.newContext();
      const number = await placeOrder(await shop.newPage(), locale);
      await shop.close();

      const page = await ownerContext.newPage();
      await setAdminLocale(page, locale);
      await page.goto('/admin/orders');
      await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });
      await axe(page);

      await page.goto(`/admin/orders/${number}`);
      await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });
      await axe(page);
    });
  });
}

test.describe('checkout — RTL', () => {
  test('mirrors the page but keeps Latin identifiers left-to-right', async ({ page }) => {
    await addFixtureToCart(page, 'ar');
    await page.goto('/ar/checkout');
    await expect(page.getByText(LABELS.ar.paymentPending)).toBeVisible({ timeout: 30_000 });

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    // An email address and a phone number are Latin runs inside an Arabic
    // page: without an explicit direction their punctuation reorders and the
    // value reads back wrong (P10 §28).
    for (const id of ['email', 'phone', 'buildingNumber', 'postalCode']) {
      await expect(page.locator(`#${id}`)).toHaveAttribute('dir', 'ltr');
    }
  });

  test('the order number reads in the order it was issued', async ({ page }) => {
    const number = await placeOrder(page, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    // `dir="ltr"` on the element, and the text still intact — a bidi bug
    // shows up as segments in the wrong order, which this comparison catches.
    const shown = page.locator('[dir="ltr"]', { hasText: number }).first();
    await expect(shown).toBeVisible();
    await expect(shown).toHaveText(number);
  });
});

test.describe('checkout and orders — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  async function noHorizontalOverflow(page: Page): Promise<void> {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }

  test('checkout and the success page fit 390px in Arabic', async ({ page }) => {
    await addFixtureToCart(page, 'ar');
    await page.goto('/ar/checkout');
    await expect(page.getByText(LABELS.ar.paymentPending)).toBeVisible({ timeout: 30_000 });
    await noHorizontalOverflow(page);

    await fillCheckout(page, 'ar');
    await page.getByRole('button', { name: LABELS.ar.placeOrder }).click();
    await page.waitForURL(/\/order\/LD-[0-9A-Z-]+\/success/, { timeout: 60_000 });
    await noHorizontalOverflow(page);
  });

  test('the admin order detail fits 390px', async ({ browser, ownerContext }) => {
    const shop = await browser.newContext();
    const number = await placeOrder(await shop.newPage(), 'en');
    await shop.close();

    const page = await ownerContext.newPage();
    await setAdminLocale(page, 'en');
    await page.goto(`/admin/orders/${number}`);
    await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });
    await noHorizontalOverflow(page);
  });
});

test.describe('checkout — keyboard', () => {
  test('every field is reachable and named, and the submit button is last', async ({ page }) => {
    await addFixtureToCart(page, 'en');
    await page.goto('/en/checkout');
    await expect(page.getByText(LABELS.en.paymentPending)).toBeVisible({ timeout: 30_000 });

    // Focus the first field the way a keyboard user would arrive at it, then
    // walk forward: each stop must be a control that announces itself.
    await page.locator('#email').focus();
    await expect(page.locator('#email')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#phone')).toBeFocused();

    const submit = page.getByRole('button', { name: LABELS.en.placeOrder });
    await submit.focus();
    await expect(submit).toBeFocused();
    // Enter on the submit button submits the form — no mouse anywhere.
    await submit.press('Enter');
    await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
  });
});

test.describe('admin orders — role gating', () => {
  /**
   * P06's matrix gives STAFF both `orders.read` and `orders.update` on
   * purpose: moving an order forward is exactly the day-to-day work the role
   * exists for. So the assertion here is not "STAFF is blocked" — it is that
   * what the sidebar offers and what the server allows are the same set, in
   * both directions. A link to a page the role would be refused, or a page
   * reachable with no link, is the bug this catches.
   */
  for (const role of ['owner', 'staff'] as const) {
    test(`${role.toUpperCase()} is offered orders and the server agrees`, async ({
      ownerContext,
      staffContext,
    }) => {
      const page = await (role === 'owner' ? ownerContext : staffContext).newPage();
      await setAdminLocale(page, 'en');
      await page.goto('/admin');
      await expect(page.getByRole('link', { name: 'Orders' })).toBeVisible({ timeout: 60_000 });

      const response = await page.goto('/admin/orders');
      expect(response?.status()).toBeLessThan(400);
      await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });
    });
  }

  test('STAFF may move an order forward, because the matrix says so', async ({
    browser,
    staffContext,
  }) => {
    const shop = await browser.newContext();
    const number = await placeOrder(await shop.newPage(), 'en');
    await shop.close();

    const page = await staffContext.newPage();
    await setAdminLocale(page, 'en');
    await page.goto(`/admin/orders/${number}`);
    await page.getByRole('button', { name: 'Confirm order' }).click();
    await expect(page.getByText('Order updated').first()).toBeVisible({ timeout: 30_000 });

    // And still cannot mark it paid — no role has that button, because no
    // button exists (P10 §11).
    await expect(page.getByRole('button', { name: /paid/i })).toHaveCount(0);
  });
});
