import { execSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

import { E2E_DISABLED, E2E_OWNER } from './fixtures/admin-credentials';

/**
 * P06 §17's required test list, driven through the real UI (not a mock):
 * login, wrong password, disabled user, logout, and — because a session
 * revoked on logout must actually be gone — that a signed-out visitor
 * bounces straight back to `/admin/login` from `/admin`.
 */

test.beforeAll(() => {
  execSync('pnpm db:seed-e2e-admins', { cwd: process.cwd(), stdio: 'inherit' });
});

/**
 * The login form's error, and only it.
 *
 * A bare `getByRole('alert')` is ambiguous: Next renders its route announcer
 * as `<div role="alert" id="__next-route-announcer__">` outside every
 * landmark, so whether the query matches one element or two depends on
 * whether that announcer happens to be mounted — which made these
 * assertions fail intermittently with a strict-mode violation rather than a
 * real one. Scoping to `main` names the alert this test actually means.
 */
function loginAlert(page: import('@playwright/test').Page) {
  return page.locator('main').getByRole('alert');
}

test.describe('admin login', () => {
  test('shows no demo credentials or implementation hints anywhere on the page', async ({
    page,
  }) => {
    await page.goto('/admin/login');
    const body = await page.textContent('body');
    expect(body?.toLowerCase()).not.toContain('auth.js');
    expect(body?.toLowerCase()).not.toContain('nextauth');
    expect(body?.toLowerCase()).not.toContain('admin123');
    expect(body).not.toContain(E2E_OWNER.password);
  });

  test('a wrong password shows a generic error and does not sign in', async ({ page }) => {
    await page.goto('/admin/login');
    await page.fill('input[name=email]', E2E_OWNER.email);
    await page.fill('input[name=password]', 'definitely-the-wrong-password-1');
    await page.click('button[type=submit]');
    await expect(loginAlert(page)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test('an unknown email shows the same generic error as a wrong password (no enumeration)', async ({
    page,
  }) => {
    await page.goto('/admin/login');
    await page.fill('input[name=email]', 'nobody-at-all@example.com');
    await page.fill('input[name=password]', 'whatever-password-1');
    await page.click('button[type=submit]');
    const unknownEmailError = await loginAlert(page).textContent();

    await page.goto('/admin/login');
    await page.fill('input[name=email]', E2E_OWNER.email);
    await page.fill('input[name=password]', 'wrong-password-for-owner-1');
    await page.click('button[type=submit]');
    const wrongPasswordError = await loginAlert(page).textContent();

    expect(unknownEmailError?.trim()).toBe(wrongPasswordError?.trim());
  });

  test('a disabled account cannot sign in, and sees the same generic error (no "account disabled" hint)', async ({
    page,
  }) => {
    await page.goto('/admin/login');
    await page.fill('input[name=email]', E2E_DISABLED.email);
    await page.fill('input[name=password]', E2E_DISABLED.password);
    await page.click('button[type=submit]');
    await expect(loginAlert(page)).toBeVisible();
    const errorText = await loginAlert(page).textContent();
    expect(errorText?.toLowerCase()).not.toContain('disab');
    expect(errorText?.toLowerCase()).not.toMatch(/معطّل|موقوف/);
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test('correct credentials sign in and land on the dashboard', async ({ page }) => {
    await page.goto('/admin/login');
    await page.fill('input[name=email]', E2E_OWNER.email);
    await page.fill('input[name=password]', E2E_OWNER.password);
    await page.click('button[type=submit]');
    await page.waitForURL('**/admin');
    await expect(page.getByText(E2E_OWNER.email)).toBeVisible();
  });

  test('an already-signed-in visitor hitting /admin/login is redirected straight to /admin', async ({
    page,
  }) => {
    await page.goto('/admin/login');
    await page.fill('input[name=email]', E2E_OWNER.email);
    await page.fill('input[name=password]', E2E_OWNER.password);
    await page.click('button[type=submit]');
    await page.waitForURL('**/admin');

    await page.goto('/admin/login');
    await page.waitForURL('**/admin');
  });
});

test.describe('admin logout', () => {
  test('logout clears the session — /admin is protected again immediately afterward', async ({
    page,
  }) => {
    await page.goto('/admin/login');
    await page.fill('input[name=email]', E2E_OWNER.email);
    await page.fill('input[name=password]', E2E_OWNER.password);
    await page.click('button[type=submit]');
    await page.waitForURL('**/admin');

    await page.getByRole('button', { name: /User menu|قائمة المستخدم/ }).click();
    await page.getByText(/Sign out|تسجيل الخروج/).click();
    await page.waitForURL('**/admin/login');

    await page.goto('/admin');
    await page.waitForURL('**/admin/login');
  });
});
