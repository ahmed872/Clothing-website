import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, test } from '@playwright/test';

/**
 * P12 §29/§30 — the new customer-identity screens judged as interface:
 * axe in both locales and both themes, the RTL mirroring rule, and the
 * 390px mobile viewport, the same standard `orders-accessibility.spec.ts`
 * already holds the P10 order surfaces to.
 */

test.describe.configure({ timeout: 180_000 });

async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).include('body').exclude('nextjs-portal').analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

function uniqueEmail(tag: string): string {
  return `p12-a11y-${tag}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function registerAndSignIn(page: Page, locale: 'ar' | 'en'): Promise<string> {
  const email = uniqueEmail(locale);
  await page.goto(`/${locale}/account/register`);
  const form = page.locator('main form');
  await form.locator('input[name="name"]').fill(locale === 'ar' ? 'مستخدم الاختبار' : 'Test User');
  await form.locator('input[name="email"]').fill(email);
  await form.locator('input[name="password"]').fill('Password123');
  await form.locator('input[name="passwordConfirmation"]').fill('Password123');
  await form.locator('button[type="submit"]').click();
  await page.waitForURL(/\/account$/, { timeout: 10_000 });
  return email;
}

const PUBLIC_PAGES = [
  '/account/login',
  '/account/register',
  '/account/forgot-password',
  '/account/reset-password',
  '/account/verify-email',
] as const;

for (const locale of ['ar', 'en'] as const) {
  test.describe(`account — public pages accessibility (axe, ${locale})`, () => {
    for (const path of PUBLIC_PAGES) {
      test(`${path}`, async ({ page }) => {
        await page.goto(`/${locale}${path}`);
        await expect(page.locator('main')).toBeVisible();
        await axe(page);
      });

      test(`${path} in dark mode`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.goto(`/${locale}${path}`);
        await expect(page.locator('main')).toBeVisible();
        await axe(page);
      });
    }
  });

  test.describe(`account — protected pages accessibility (axe, ${locale})`, () => {
    test('overview, profile, and the empty orders list', async ({ page }) => {
      await registerAndSignIn(page, locale);

      await expect(page.locator('main')).toBeVisible();
      await axe(page);

      await page.goto(`/${locale}/account/profile`);
      await expect(page.locator('main form')).toBeVisible();
      await axe(page);

      await page.goto(`/${locale}/account/orders`);
      await expect(page.locator('main')).toBeVisible();
      await axe(page);
    });

    test('overview in dark mode', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await registerAndSignIn(page, locale);
      await expect(page.locator('main')).toBeVisible();
      await axe(page);
    });
  });
}

test.describe('account — RTL', () => {
  test('the login and register pages mirror, with Latin fields kept left-to-right', async ({
    page,
  }) => {
    await page.goto('/ar/account/login');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('main form input[name="email"]')).toHaveAttribute('dir', 'ltr');

    await page.goto('/ar/account/register');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('main form input[name="email"]')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('main form input[name="phone"]')).toHaveAttribute('dir', 'ltr');
  });

  test('the profile page mirrors and keeps the phone field left-to-right', async ({ page }) => {
    await registerAndSignIn(page, 'ar');
    await page.goto('/ar/account/profile');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('main form input[name="phone"]')).toHaveAttribute('dir', 'ltr');
  });
});

test.describe('account — mobile (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  async function noHorizontalOverflow(page: Page): Promise<void> {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }

  test('login, register, and forgot-password fit 390px in Arabic', async ({ page }) => {
    await page.goto('/ar/account/login');
    await noHorizontalOverflow(page);
    await page.goto('/ar/account/register');
    await noHorizontalOverflow(page);
    await page.goto('/ar/account/forgot-password');
    await noHorizontalOverflow(page);
  });

  test('the account shell (overview, profile, orders) fits 390px', async ({ page }) => {
    await registerAndSignIn(page, 'ar');
    await noHorizontalOverflow(page);

    await page.goto('/ar/account/profile');
    await noHorizontalOverflow(page);

    await page.goto('/ar/account/orders');
    await noHorizontalOverflow(page);
  });
});

test.describe('account — keyboard', () => {
  test('every login field is reachable, and Enter on submit works with no mouse', async ({
    page,
  }) => {
    await page.goto('/en/account/login');
    const emailField = page.locator('main form input[name="email"]');
    const passwordField = page.locator('main form input[name="password"]');

    await emailField.focus();
    await expect(emailField).toBeFocused();
    await page.keyboard.type('nobody-keyboard-test@example.com');
    await page.keyboard.press('Tab');
    await expect(passwordField).toBeFocused();
    await page.keyboard.type('WrongPassword1');

    const submit = page.getByRole('button', { name: 'Sign in' });
    await submit.focus();
    await expect(submit).toBeFocused();
    // Enter on the submit button submits the form — no mouse anywhere —
    // and a wrong-but-well-formed credential reaches the real server
    // action, unlike an empty field, which the browser's own HTML5
    // validation would intercept before any request is made.
    await submit.press('Enter');
    await expect(page.locator('main').getByRole('alert')).toBeVisible({ timeout: 10_000 });
  });
});
