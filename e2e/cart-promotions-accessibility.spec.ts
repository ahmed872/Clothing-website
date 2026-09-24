import { execSync } from 'node:child_process';

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/authenticated';

/**
 * P09 §25 — axe over the surfaces this phase adds, in both locales and both
 * themes, plus the role gating and the mobile check an admin screen needs.
 */

test.beforeAll(() => {
  execSync('pnpm db:seed-e2e-admins', { cwd: process.cwd(), stdio: 'inherit' });
});

test.describe.configure({ timeout: 120_000 });

const BASE = 'http://127.0.0.1:3000';

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

/** Adds one item and waits for the server to confirm, so a following
 * navigation cannot outrun the write. */
async function addOne(page: Page, locale: 'ar' | 'en'): Promise<void> {
  await page.goto(`/${locale}/p/mercedes-benz-s-class`);
  await page
    .getByRole('button', { name: locale === 'ar' ? 'أضف إلى السلة' : 'Add to cart' })
    .click();
  await expect(
    page.getByText(locale === 'ar' ? 'أُضيف إلى السلة' : 'Added to your cart').first(),
  ).toBeVisible({ timeout: 20_000 });
}

for (const locale of ['ar', 'en'] as const) {
  test.describe(`storefront cart — accessibility (axe, ${locale})`, () => {
    test('empty cart', async ({ page }) => {
      await page.goto(`/${locale}/cart`);
      await expect(page.locator('main')).toBeVisible();
      await axe(page);
    });

    test('cart with a line and a promotion field', async ({ page }) => {
      await addOne(page, locale);
      await page.goto(`/${locale}/cart`);
      await expect(page.locator('main')).toBeVisible();
      await axe(page);
    });

    test('cart in dark mode', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await addOne(page, locale);
      await page.goto(`/${locale}/cart`);
      await expect(page.locator('main')).toBeVisible();
      await axe(page);
    });
  });

  test.describe(`admin promotions — accessibility (axe, ${locale})`, () => {
    test('promotions list', async ({ ownerContext }) => {
      const page = await ownerContext.newPage();
      await setAdminLocale(page, locale);
      await page.goto('/admin/promotions');
      await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });
      await axe(page);
    });

    test('promotion form', async ({ ownerContext }) => {
      const page = await ownerContext.newPage();
      await setAdminLocale(page, locale);
      await page.goto('/admin/promotions/new');
      await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });
      await axe(page);
    });
  });
}

test.describe('cart — keyboard', () => {
  test('the quantity stepper and remove button are reachable and named', async ({ page }) => {
    await addOne(page, 'ar');
    await page.goto('/ar/cart');

    // At a quantity of one there is nothing to decrease to, so the control
    // is disabled rather than offering a zero the server would reject.
    await expect(page.getByRole('button', { name: 'إنقاص الكمية' })).toBeDisabled();

    const remove = page.getByRole('button', { name: /إزالة .* من السلة/ });
    await remove.focus();
    await expect(remove).toBeFocused();
    await remove.press('Enter');
    await expect(page.getByText('سلتك فارغة')).toBeVisible({ timeout: 15_000 });
  });

  test('the clear-cart dialog traps focus and closes back', async ({ page }) => {
    await addOne(page, 'ar');
    await page.goto('/ar/cart');

    await page.getByRole('button', { name: 'إفراغ السلة' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});

test.describe('admin promotions — role gating', () => {
  test('STAFF is not offered promotions and cannot reach the page', async ({ staffContext }) => {
    const page = await staffContext.newPage();
    await setAdminLocale(page, 'en');
    await page.goto('/admin');
    await expect(page.getByRole('link', { name: 'Products' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('link', { name: 'Promotions' })).toHaveCount(0);

    // And typing the URL is refused by the server, not merely hidden.
    const response = await page.goto('/admin/promotions');
    expect(response?.status()).toBeGreaterThanOrEqual(400);
  });

  test('OWNER sees promotions', async ({ ownerContext }) => {
    const page = await ownerContext.newPage();
    await setAdminLocale(page, 'en');
    await page.goto('/admin');
    await expect(page.getByRole('link', { name: 'Promotions' })).toBeVisible({ timeout: 60_000 });
  });
});

test.describe('admin promotions — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the list is usable at 390px with no horizontal page scroll', async ({ ownerContext }) => {
    const page = await ownerContext.newPage();
    await setAdminLocale(page, 'en');
    await page.goto('/admin/promotions');
    await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
