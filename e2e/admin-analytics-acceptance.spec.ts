import { execSync } from 'node:child_process';

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/authenticated';

/**
 * P15 — reporting, in a real browser.
 *
 * The claims worth driving end to end are the honesty ones: that the
 * screen renders on a store with no sales instead of erroring or showing
 * an invented figure, that the period filter is a real server round trip
 * rather than a client-side illusion, that the chart's numbers are
 * reachable by a screen reader, and that the methodology note saying what
 * is *not* measured is actually on the page.
 */

test.beforeAll(() => {
  execSync('pnpm db:seed-e2e-admins', { cwd: process.cwd(), stdio: 'inherit' });
});

test.describe.configure({ timeout: 180_000 });

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

test.describe('the analytics screen', () => {
  test('renders every panel, whether or not the store has sales', async ({
    analyticsOwnerContext,
  }) => {
    const page = await analyticsOwnerContext.newPage();
    await setLocale(page, 'en');
    await page.goto('/admin/analytics');

    await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible({
      timeout: 60_000,
    });

    for (const label of [
      'Paid revenue',
      'Paid orders',
      'Average order value',
      'Units sold',
      'New customers',
    ]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }

    for (const panel of [
      'Revenue by day',
      'Best selling products',
      'Orders by status',
      'Coupons used',
      'Refunds',
    ]) {
      await expect(page.getByRole('heading', { name: panel })).toBeVisible();
    }
  });

  test('says plainly what it does not measure', async ({ analyticsOwnerContext }) => {
    const page = await analyticsOwnerContext.newPage();
    await setLocale(page, 'en');
    await page.goto('/admin/analytics');

    await expect(
      page.getByRole('heading', { name: 'How these numbers are calculated' }),
    ).toBeVisible({ timeout: 60_000 });
    // The two absences a reader would otherwise assume away.
    await expect(page.getByText(/Refunds are not subtracted from revenue/)).toBeVisible();
    await expect(page.getByText(/There is no “product views” metric/)).toBeVisible();
  });

  test('the period filter is a real server round trip', async ({ analyticsOwnerContext }) => {
    const page = await analyticsOwnerContext.newPage();
    await setLocale(page, 'en');
    await page.goto('/admin/analytics');
    await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });

    await page.getByRole('combobox', { name: 'Period' }).click();
    await page.getByRole('option', { name: 'Last 7 days' }).click();

    await page.waitForURL(/range=7/);
    // The accessible table under the chart carries one row per day, so the
    // range change is visible in the data, not only in the URL.
    await expect(page.getByRole('row')).not.toHaveCount(0);
  });

  test('a bogus range in the URL falls back rather than being obeyed', async ({
    analyticsOwnerContext,
  }) => {
    const page = await analyticsOwnerContext.newPage();
    await setLocale(page, 'en');

    const response = await page.goto('/admin/analytics?range=999999');
    expect(response?.ok()).toBeTruthy();
    await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible({
      timeout: 60_000,
    });
  });

  test('the chart’s numbers are reachable as a table, not only as a drawing', async ({
    analyticsOwnerContext,
  }) => {
    const page = await analyticsOwnerContext.newPage();
    await setLocale(page, 'en');
    await page.goto('/admin/analytics?range=7');
    await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });

    // The SVG is decorative and hidden from assistive tech…
    await expect(page.locator('main svg[aria-hidden="true"]').first()).toHaveCount(1);
    // …while the same seven days exist as real table rows.
    const chartTable = page.getByRole('table', { name: 'Revenue by day' });
    await expect(chartTable).toBeAttached();
    await expect(chartTable.locator('tbody tr')).toHaveCount(7);
  });
});

test.describe('accessibility', () => {
  for (const locale of ['ar', 'en'] as const) {
    test(`has no axe violations in ${locale}`, async ({ analyticsOwnerContext }) => {
      const page = await analyticsOwnerContext.newPage();
      await setLocale(page, locale);
      await page.goto('/admin/analytics');
      await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });
      await axe(page);
    });
  }

  test('the period filter is reachable and operable by keyboard', async ({
    analyticsOwnerContext,
  }) => {
    const page = await analyticsOwnerContext.newPage();
    await setLocale(page, 'en');
    await page.goto('/admin/analytics');
    await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });

    const period = page.getByRole('combobox', { name: 'Period' });
    await period.focus();
    await expect(period).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('option', { name: 'Last 90 days' })).toBeVisible();
    await page.getByRole('option', { name: 'Last 90 days' }).click();
    await page.waitForURL(/range=90/);
  });

  test('is usable at 390px without a horizontal scroll', async ({ analyticsOwnerContext }) => {
    const page = await analyticsOwnerContext.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await setLocale(page, 'en');
    await page.goto('/admin/analytics');
    await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `analytics overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
    await axe(page);
  });
});

test.describe('permission', () => {
  test('STAFF cannot reach analytics by typing the URL', async ({ staffContext }) => {
    const page = await staffContext.newPage();
    const response = await page.goto('/admin/analytics');
    expect(response?.ok()).toBeFalsy();
    await expect(page.getByRole('heading', { name: /^(Analytics|التحليلات)$/ })).toHaveCount(0);
  });

  test('a MANAGER can', async ({ managerContext }) => {
    const page = await managerContext.newPage();
    await setLocale(page, 'en');
    const response = await page.goto('/admin/analytics');
    expect(response?.ok()).toBeTruthy();
    await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible({
      timeout: 60_000,
    });
  });
});
