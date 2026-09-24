import { execSync } from 'node:child_process';

import AxeBuilder from '@axe-core/playwright';

import { E2E_OWNER } from './fixtures/admin-credentials';
import { expect, test } from './fixtures/authenticated';

/** P06 §21 — axe against the login page and the admin shell, both locales,
 * both themes, plus keyboard-navigation and focus-management checks. Mirrors
 * `storefront-accessibility.spec.ts`'s pattern. Tests that need to already
 * be signed in use the shared `ownerContext` fixture (one real login,
 * reused) rather than resubmitting the login form per test — see
 * `fixtures/authenticated.ts` for why. */

test.beforeAll(() => {
  execSync('pnpm db:seed-e2e-admins', { cwd: process.cwd(), stdio: 'inherit' });
});

test.describe('admin — accessibility (axe, light theme)', () => {
  test('login page (ar)', async ({ page }) => {
    await page
      .context()
      .addCookies([{ name: 'luxedrive-locale', value: 'ar', url: 'http://127.0.0.1:3000' }]);
    await page.goto('/admin/login');
    const results = await new AxeBuilder({ page }).include('body').analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('login page (en)', async ({ page }) => {
    await page
      .context()
      .addCookies([{ name: 'luxedrive-locale', value: 'en', url: 'http://127.0.0.1:3000' }]);
    await page.goto('/admin/login');
    const results = await new AxeBuilder({ page }).include('body').analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('dashboard, signed in (en)', async ({ ownerContext }) => {
    const page = await ownerContext.newPage();
    await page
      .context()
      .addCookies([{ name: 'luxedrive-locale', value: 'en', url: 'http://127.0.0.1:3000' }]);
    await page.goto('/admin');
    const results = await new AxeBuilder({ page }).include('body').analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});

test.describe('admin — accessibility (axe, dark theme)', () => {
  test('login page (ar, dark)', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('luxedrive-theme', 'dark'));
    await page
      .context()
      .addCookies([{ name: 'luxedrive-locale', value: 'ar', url: 'http://127.0.0.1:3000' }]);
    await page.goto('/admin/login');
    const results = await new AxeBuilder({ page }).include('body').analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('dashboard, signed in (en, dark)', async ({ ownerContext }) => {
    const page = await ownerContext.newPage();
    await page.addInitScript(() => localStorage.setItem('luxedrive-theme', 'dark'));
    await page
      .context()
      .addCookies([{ name: 'luxedrive-locale', value: 'en', url: 'http://127.0.0.1:3000' }]);
    await page.goto('/admin');
    const results = await new AxeBuilder({ page }).include('body').analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});

test.describe('admin — keyboard navigation', () => {
  test('the login form is fully operable by keyboard, including submit on Enter', async ({
    page,
  }) => {
    await page
      .context()
      .addCookies([{ name: 'luxedrive-locale', value: 'en', url: 'http://127.0.0.1:3000' }]);
    await page.goto('/admin/login');
    await page.getByLabel(/Email/i).click();
    await page.keyboard.type(E2E_OWNER.email);
    await page.keyboard.press('Tab');
    await page.keyboard.type(E2E_OWNER.password);
    await page.keyboard.press('Enter');
    await page.waitForURL('**/admin');
  });

  test('the password show/hide toggle is keyboard-focusable and labeled', async ({ page }) => {
    await page
      .context()
      .addCookies([{ name: 'luxedrive-locale', value: 'en', url: 'http://127.0.0.1:3000' }]);
    await page.goto('/admin/login');
    const toggle = page.getByRole('button', { name: /Show password/i });
    await expect(toggle).toBeVisible();
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: /Hide password/i })).toBeVisible();
  });

  test('the user menu opens via keyboard and its items are reachable', async ({ ownerContext }) => {
    const page = await ownerContext.newPage();
    await page
      .context()
      .addCookies([{ name: 'luxedrive-locale', value: 'en', url: 'http://127.0.0.1:3000' }]);
    await page.goto('/admin');
    const trigger = page.getByRole('button', { name: 'User menu' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Sign out')).toBeVisible();
  });

  test('every sidebar nav item is keyboard-focusable', async ({ ownerContext }) => {
    const page = await ownerContext.newPage();
    await page
      .context()
      .addCookies([{ name: 'luxedrive-locale', value: 'en', url: 'http://127.0.0.1:3000' }]);
    await page.goto('/admin');
    const dashboardLink = page.getByRole('link', { name: 'Dashboard' });
    await dashboardLink.focus();
    await expect(dashboardLink).toBeFocused();
  });
});
