import { execSync } from 'node:child_process';

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/authenticated';

/**
 * P08 §18–§22 — axe over the screens this phase adds, in both locales
 * (Arabic RTL and English LTR), plus the role gating and the mobile layout
 * those screens have to hold up under.
 *
 * Split from the P07 catalog file so each phase's surface stays legible on
 * its own.
 */

test.beforeAll(() => {
  execSync('pnpm db:seed-e2e-admins', { cwd: process.cwd(), stdio: 'inherit' });
});

// Each test visits an admin route for the first time against a dev server,
// which compiles it on demand; the axe run itself is fast.
test.describe.configure({ timeout: 120_000 });

const BASE = 'http://127.0.0.1:3000';

async function setLocale(page: Page, locale: 'ar' | 'en'): Promise<void> {
  await page.context().addCookies([{ name: 'luxedrive-locale', value: locale, url: BASE }]);
}

async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('body')
    // Next's dev-only overlay sits outside every landmark and trips the
    // `region` rule on every page; it never ships to production.
    .exclude('nextjs-portal')
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

for (const locale of ['ar', 'en'] as const) {
  test.describe(`admin inventory & pricing — accessibility (axe, ${locale})`, () => {
    test('inventory list', async ({ ownerContext }) => {
      const page = await ownerContext.newPage();
      await setLocale(page, locale);
      await page.goto('/admin/inventory');
      await expect(page.locator('main')).toBeVisible();
      await axe(page);
    });

    test('inventory history', async ({ ownerContext }) => {
      const page = await ownerContext.newPage();
      await setLocale(page, locale);
      await page.goto('/admin/inventory/history');
      await expect(page.locator('main')).toBeVisible();
      await axe(page);
    });

    test('pricing list', async ({ ownerContext }) => {
      const page = await ownerContext.newPage();
      await setLocale(page, locale);
      await page.goto('/admin/pricing');
      await expect(page.locator('main')).toBeVisible();
      await axe(page);
    });

    test('the stock adjustment dialog', async ({ ownerContext }) => {
      const page = await ownerContext.newPage();
      await setLocale(page, locale);
      await page.goto('/admin/inventory');
      const adjust = page.locator('tbody tr').first().getByRole('button').first();
      await expect(adjust).toBeVisible({ timeout: 60_000 });
      await adjust.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await axe(page);
    });
  });
}

test.describe('admin inventory & pricing — role gating', () => {
  test('STAFF can count stock but is not offered the pricing screen', async ({ staffContext }) => {
    const page = await staffContext.newPage();
    await setLocale(page, 'en');
    await page.goto('/admin');

    // `inventory.read` — STAFF has it, so the link is there…
    await expect(page.getByRole('link', { name: 'Inventory' })).toBeVisible({ timeout: 60_000 });
    // …and `products.update` — STAFF does not, so Pricing is never rendered.
    await expect(page.getByRole('link', { name: 'Pricing' })).toHaveCount(0);

    await page.goto('/admin/inventory');
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
    // The permission that gates adjusting is one STAFF holds, so the
    // control is offered — and the server checks it again on every call.
    await expect(page.locator('tbody tr').first().getByRole('button').first()).toBeVisible();
  });

  test('OWNER sees both', async ({ ownerContext }) => {
    const page = await ownerContext.newPage();
    await setLocale(page, 'en');
    await page.goto('/admin');
    await expect(page.getByRole('link', { name: 'Inventory' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('link', { name: 'Pricing' })).toBeVisible();
  });
});

test.describe('admin inventory — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the inventory screen is usable at 390px, with no horizontal page scroll', async ({
    ownerContext,
  }) => {
    const page = await ownerContext.newPage();
    await setLocale(page, 'en');
    await page.goto('/admin/inventory');
    await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });

    // The table scrolls inside its own container; the page itself must not.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // The sidebar collapses into the header drawer below `lg`.
    await expect(page.getByRole('button', { name: /navigation/i })).toBeVisible();
  });
});
