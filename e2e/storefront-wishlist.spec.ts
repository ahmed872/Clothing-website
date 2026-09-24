import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * The wishlist page.
 *
 * This exists because the header's heart icon linked to
 * `/[locale]/wishlist` from the day the storefront was built, and the route
 * did not — every visitor who pressed it got a 404 in production. The
 * toggle, the count badge and the `localStorage` list were all real; only
 * the page was missing.
 *
 * So the first assertion here is the plainest one: the link in the header
 * goes somewhere. `storefront-pdp.spec.ts` already covers the toggle
 * itself persisting; these cover what the toggle was *for*.
 */

const PRODUCT = { slug: 'mercedes-benz-s-class', name: 'Mercedes-Benz S-Class' };

async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('body')
    // Next's dev-only overlay sits outside every landmark and trips the
    // `region` rule on every page; it never ships to production.
    .exclude('nextjs-portal')
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test.describe('the wishlist page', () => {
  test('the header heart reaches a real page, not a 404', async ({ page }) => {
    await page.goto('/ar');
    const response = await page.goto('/ar/wishlist');

    expect(response?.status(), 'the wishlist route must exist').toBe(200);
    await expect(page.getByRole('heading', { name: 'المفضلة', level: 1 })).toBeVisible();
  });

  test('says the list is empty rather than showing a blank page', async ({ page }) => {
    await page.goto('/ar/wishlist');

    await expect(page.getByText('قائمة المفضلة فاضية')).toBeVisible();
    // The empty state's own call to action must not be a second dead link.
    const browse = page.getByRole('link', { name: 'تصفّح المنتجات' });
    await expect(browse).toBeVisible();
    await browse.click();
    await expect(page).toHaveURL(/\/ar\/(c\/|$)/);
  });

  test('a product saved on its own page shows up here, and can be removed', async ({ page }) => {
    await page.goto(`/ar/p/${PRODUCT.slug}`);

    // Scoped to the purchase panel — related products below render their
    // own wishlist buttons with the same accessible name.
    const purchasePanel = page.locator('h1').locator('..');
    await purchasePanel.getByRole('button', { name: 'أضف إلى المفضلة' }).click();
    await expect(purchasePanel.getByRole('button', { name: 'إزالة من المفضلة' })).toBeVisible();

    // Reached the way a real visitor reaches it: the header icon.
    await page.getByRole('link', { name: 'المفضلة' }).click();
    await page.waitForURL('**/ar/wishlist');

    await expect(page.getByRole('link', { name: new RegExp(PRODUCT.name) }).first()).toBeVisible();
    await expect(page.getByText('قائمة المفضلة فاضية')).toHaveCount(0);

    // Removing the last item empties the page without a reload — the grid
    // and the header badge read the same store.
    await page.getByRole('button', { name: 'إزالة من المفضلة' }).first().click();
    await expect(page.getByText('قائمة المفضلة فاضية')).toBeVisible();
  });

  test('is honest that the list lives only in this browser', async ({ page }) => {
    await page.goto(`/ar/p/${PRODUCT.slug}`);
    const purchasePanel = page.locator('h1').locator('..');
    await purchasePanel.getByRole('button', { name: 'أضف إلى المفضلة' }).click();

    await page.goto('/ar/wishlist');
    await expect(page.getByText(/محفوظة في هذا المتصفح فقط/)).toBeVisible();
  });

  test('renders in English too', async ({ page }) => {
    await page.goto('/en/wishlist');
    await expect(page.getByRole('heading', { name: 'Wishlist', level: 1 })).toBeVisible();
    await expect(page.getByText('Your wishlist is empty')).toBeVisible();
  });
});

test.describe('accessibility', () => {
  for (const locale of ['ar', 'en'] as const) {
    test(`the empty wishlist has no axe violations in ${locale}`, async ({ page }) => {
      await page.goto(`/${locale}/wishlist`);
      await expect(page.locator('main')).toBeVisible();
      await axe(page);
    });

    test(`a populated wishlist has no axe violations in ${locale}`, async ({ page }) => {
      await page.goto(`/${locale}/p/${PRODUCT.slug}`);
      const purchasePanel = page.locator('h1').locator('..');
      await purchasePanel
        .getByRole('button', { name: locale === 'ar' ? 'أضف إلى المفضلة' : 'Add to wishlist' })
        .click();

      await page.goto(`/${locale}/wishlist`);
      await expect(
        page.getByRole('link', { name: new RegExp(PRODUCT.name) }).first(),
      ).toBeVisible();
      await axe(page);
    });
  }

  test('is usable at 390px without a horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/ar/p/${PRODUCT.slug}`);
    const purchasePanel = page.locator('h1').locator('..');
    await purchasePanel.getByRole('button', { name: 'أضف إلى المفضلة' }).click();

    await page.goto('/ar/wishlist');
    await expect(page.locator('main')).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `the wishlist overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
  });
});
