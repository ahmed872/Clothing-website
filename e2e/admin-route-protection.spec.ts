import { execSync } from 'node:child_process';

import { expect, test } from './fixtures/authenticated';

/**
 * P06 §17/§8: a Client Component `if (!isAdmin) redirect()` is explicitly
 * insufficient — this proves the server boundary itself blocks a direct,
 * cookie-less request, and separately that a signed-in role without a
 * section's permission cannot reach it either, purely by typing the URL
 * (the sidebar never even offers that link to STAFF — `nav-config.test.ts`
 * already proves that; this proves the server enforces it independent of
 * what the UI shows). Authenticated cases use the shared `ownerContext`/
 * `staffContext` fixtures (one real login each, reused) rather than
 * resubmitting the login form per test — see `fixtures/authenticated.ts`.
 */

test.beforeAll(() => {
  execSync('pnpm db:seed-e2e-admins', { cwd: process.cwd(), stdio: 'inherit' });
});

test.describe('unauthenticated direct access', () => {
  test('/admin redirects to /admin/login', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForURL('**/admin/login');
  });

  test('/admin/settings (a specific protected section) redirects to /admin/login', async ({
    page,
  }) => {
    await page.goto('/admin/settings');
    await page.waitForURL('**/admin/login');
  });

  test('/admin/users redirects to /admin/login', async ({ page }) => {
    await page.goto('/admin/users');
    await page.waitForURL('**/admin/login');
  });
});

test.describe('authenticated but unauthorized direct access (permission-aware, server-enforced)', () => {
  test('STAFF signed in, typing /admin/settings directly, never sees the settings screen', async ({
    staffContext,
  }) => {
    const page = await staffContext.newPage();
    await page.goto('/admin');

    // Confirm STAFF's own dashboard renders (a permission it does have is
    // linked) but never links to Settings (one it doesn't) — the sidebar
    // itself is already permission-filtered, before the direct-URL check
    // below even runs.
    await expect(page.getByRole('link', { name: /Products|المنتجات/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Settings|الإعدادات/ })).toHaveCount(0);

    const response = await page.goto('/admin/settings');
    // Whatever status Next's default error handling assigns a thrown
    // FORBIDDEN, the protected content itself must never have rendered.
    // (Until P15 this asserted on the shared "being built" placeholder that
    // used to stand in for Settings; the real screen is what must not
    // appear now.)
    expect(response?.ok()).toBeFalsy();
    await expect(page.getByRole('heading', { name: /^(Settings|الإعدادات)$/ })).toHaveCount(0);
  });

  test('STAFF signed in, typing /admin/users directly (Super-Admin-only), never sees it either', async ({
    staffContext,
  }) => {
    const page = await staffContext.newPage();
    const response = await page.goto('/admin/users');
    expect(response?.ok()).toBeFalsy();
    await expect(page.getByRole('heading', { name: /^(Users|المستخدمون)$/ })).toHaveCount(0);
  });

  /**
   * The one that actually matters for `users.manage` (P14 §B): MANAGER
   * holds every other admin permission, so a Users section gated on "is
   * this an admin" instead of on that one permission would let this
   * account straight in. It gets neither the link nor the page — and the
   * create form behind it is refused the same way.
   */
  test('MANAGER — every other permission, but never Users', async ({ managerContext }) => {
    const page = await managerContext.newPage();
    await page.goto('/admin');
    await expect(page.getByRole('link', { name: /Promotions|العروض والخصومات/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^(Users|المستخدمون)$/ })).toHaveCount(0);

    for (const path of ['/admin/users', '/admin/users/new']) {
      const response = await page.goto(path);
      expect(response?.ok()).toBeFalsy();
      await expect(page.getByRole('button', { name: /Create user|إنشاء المستخدم/ })).toHaveCount(0);
    }
  });

  test('STAFF *can* reach a section their role does hold permission for (Products)', async ({
    staffContext,
  }) => {
    const page = await staffContext.newPage();
    await page.goto('/admin/products');
    // Products is a real screen as of P07, not the placeholder it was when
    // this test was written: STAFF holds `products.read`, so it gets the
    // list itself. What it still must not get is any way to change it —
    // covered by `admin-catalog-*` and the server-side matrix.
    await expect(page.getByRole('heading', { name: /Products|المنتجات/ })).toBeVisible();
  });

  test('OWNER can reach every section, including Users', async ({ ownerContext }) => {
    const page = await ownerContext.newPage();
    await page.goto('/admin/users');
    // Users is a real screen as of P14, not the placeholder it was when
    // this test was written.
    await expect(page.getByRole('heading', { name: /^(Users|المستخدمون)$/ })).toBeVisible();
    await expect(page.getByText('e2e-owner@example.com')).toBeVisible();
  });
});
