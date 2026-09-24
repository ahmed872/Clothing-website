import { expect, test } from '@playwright/test';

/**
 * Product detail page — gallery, tabs, wishlist (client-side placeholder),
 * add-to-cart (a real server-backed cart since P09), related products,
 * recently-viewed. This catalog's real products are all single-variant (no
 * `ProductOption` rows — cars don't need Color/Size), so the generic
 * variant selector's own matching logic is covered at the unit level
 * (`variant-selection.test.ts`, `product-detail.service.test.ts`, both
 * against real multi-option DB fixtures) rather than here.
 */

test.describe('product detail page', () => {
  test('renders gallery, price, stock and SKU from real data', async ({ page }) => {
    await page.goto('/ar/p/mercedes-benz-s-class');
    await expect(page.getByRole('heading', { name: 'Mercedes-Benz S-Class' })).toBeVisible();
    await expect(page.getByText('125,000.00')).toBeVisible();
    await expect(page.getByText('متوفر', { exact: true })).toBeVisible();
    await expect(page.getByText('MERCEDES-BENZ-MERCEDES-BENZ-S-CLASS-2024')).toBeVisible();
  });

  test('gallery thumbnails switch the main image', async ({ page }) => {
    await page.goto('/ar/p/mercedes-benz-s-class');
    const thumbs = page.getByRole('radio');
    await expect(thumbs).toHaveCount(3);
    await expect(thumbs.nth(0)).toHaveAttribute('aria-checked', 'true');
    await thumbs.nth(1).click();
    await expect(thumbs.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(thumbs.nth(0)).toHaveAttribute('aria-checked', 'false');
  });

  test('description/specifications/reviews tabs switch content', async ({ page }) => {
    await page.goto('/ar/p/mercedes-benz-s-class');
    await expect(page.getByText('قمة الفخامة والتقنية')).toBeVisible();
    await page.getByRole('tab', { name: 'المواصفات' }).click();
    await expect(page.getByText('Hybrid')).toBeVisible();
    await page.getByRole('tab', { name: /التقييمات/ }).click();
    await expect(page.getByText('لا توجد تقييمات بعد')).toBeVisible();
  });

  /**
   * P05 asserted that this button honestly said the cart did not exist yet.
   * That behaviour is gone on purpose: P09 built the cart, so the button now
   * adds to it. The test is rewritten rather than deleted, because the thing
   * worth guarding is unchanged — pressing it must do the real thing and say
   * so, never fake a success.
   */
  test('add to cart adds the item and confirms it', async ({ page }) => {
    await page.goto('/ar/p/mercedes-benz-s-class');
    await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
    // The toast renders its message twice on purpose — once visibly, once
    // in a screen-reader live region — so this targets the first.
    await expect(page.getByText('أُضيف إلى السلة').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'السلة' })).toContainText('1');
  });

  test('wishlist toggle persists across a reload (localStorage placeholder)', async ({ page }) => {
    await page.goto('/ar/p/mercedes-benz-s-class');
    // Scoped to the purchase panel — "related products" below on the same
    // page render their own wishlist buttons with the same accessible name.
    const purchasePanel = page.locator('h1').locator('..');
    const wishlistButton = purchasePanel.getByRole('button', { name: 'أضف إلى المفضلة' });
    await wishlistButton.click();
    await expect(purchasePanel.getByRole('button', { name: 'إزالة من المفضلة' })).toBeVisible();
    await page.reload();
    await expect(purchasePanel.getByRole('button', { name: 'إزالة من المفضلة' })).toBeVisible();
  });

  test('related products link to other real, published cars', async ({ page }) => {
    await page.goto('/ar/p/mercedes-benz-s-class');
    const related = page.getByRole('heading', { name: 'منتجات ذات صلة' });
    await expect(related).toBeVisible();
    const relatedSection = page.locator('section', { has: related });
    await expect(relatedSection.getByRole('link').first()).toBeVisible();
  });

  test('visiting a product records it in "recently viewed" on another product page', async ({
    page,
  }) => {
    await page.goto('/ar/p/mercedes-benz-s-class');
    await page.goto('/ar/p/tesla-model-s');
    await expect(page.getByRole('heading', { name: 'شوهد مؤخرًا' })).toBeVisible();
    await expect(
      page
        .getByRole('heading', { name: 'شوهد مؤخرًا' })
        .locator('..')
        .getByRole('link', { name: /Mercedes-Benz S-Class/i }),
    ).toBeVisible();
  });
});
