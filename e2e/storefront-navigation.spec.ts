import { expect, test } from '@playwright/test';

/**
 * Storefront navigation (P05): the header/footer chrome, category browsing,
 * breadcrumbs, and search — against the real seeded demo catalog
 * (`pnpm db:seed-storefront-demo`), not fixtures. Assumes that seed has run
 * against the dev database the Playwright webServer points at.
 */

test.describe('storefront navigation', () => {
  test('root redirects based on Accept-Language, defaulting to Arabic', async ({ browser }) => {
    // An Arabic-preferring visitor lands on /ar... (Playwright's `locale`
    // context option, not `extraHTTPHeaders` — Chromium's own
    // Accept-Language for navigation requests isn't reliably overridden by
    // a plain extra header, `locale` is the real API for this.)
    const arContext = await browser.newContext({ locale: 'ar' });
    const arPage = await arContext.newPage();
    await arPage.goto('/');
    await expect(arPage).toHaveURL(/\/ar$/);
    await expect(arPage.locator('html')).toHaveAttribute('dir', 'rtl');
    await arContext.close();

    // ...and a visitor with no usable language preference at all (proxy.ts's
    // fallback, not a cookie or Accept-Language match) also lands on /ar —
    // the store's default (ADR-023).
    const noPrefContext = await browser.newContext({ locale: 'fr-FR' });
    const noPrefPage = await noPrefContext.newPage();
    await noPrefPage.goto('/');
    await expect(noPrefPage).toHaveURL(/\/ar$/);
    await noPrefContext.close();
  });

  test('an English-preferring visitor is redirected to /en', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await context.close();
  });

  test('homepage renders real published sections', async ({ page }) => {
    await page.goto('/ar');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /Mercedes-Benz S-Class/i }).first()).toBeVisible();
  });

  test('header category link navigates to a real category page', async ({ page }) => {
    await page.goto('/ar');
    await page.getByRole('navigation').getByRole('link', { name: 'سيارات' }).click();
    await expect(page).toHaveURL(/\/ar\/c\/cars$/);
    await expect(page.getByRole('heading', { name: 'سيارات' })).toBeVisible();
  });

  test('breadcrumbs on a product page link back through the category', async ({ page }) => {
    await page.goto('/ar/p/mercedes-benz-s-class');
    const breadcrumb = page.getByRole('navigation', { name: 'مسار التصفح' });
    await expect(breadcrumb.getByRole('link', { name: 'الرئيسية' })).toBeVisible();
    await breadcrumb.getByRole('link', { name: 'سيارات' }).click();
    await expect(page).toHaveURL(/\/ar\/c\/cars$/);
  });

  test('search bar navigates to search results with the typed query', async ({ page }) => {
    await page.goto('/ar');
    const search = page.getByRole('search').first();
    await search.getByRole('searchbox').fill('Tesla');
    await search.getByRole('searchbox').press('Enter');
    await expect(page).toHaveURL(/\/ar\/search\?q=Tesla/);
    await expect(page.getByRole('link', { name: /Tesla Model S/i }).first()).toBeVisible();
  });

  test('search with no query shows the "search the store" prompt, not results', async ({
    page,
  }) => {
    await page.goto('/ar/search');
    await expect(page.getByText('ابحث في المتجر')).toBeVisible();
  });

  test('a nonexistent category 404s to the shared not-found page', async ({ page }) => {
    const response = await page.goto('/ar/c/does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByText('الصفحة غير موجودة', { exact: false })).toBeVisible();
  });

  test('a nonexistent product 404s', async ({ page }) => {
    const response = await page.goto('/ar/p/does-not-exist');
    expect(response?.status()).toBe(404);
  });
});
