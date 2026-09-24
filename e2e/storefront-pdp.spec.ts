import { expect, test } from '@playwright/test';

/**
 * Product detail page — gallery, colour and size selection, tabs, wishlist
 * (client-side placeholder), add-to-cart (a real server-backed cart since
 * P09), related products, recently-viewed. Every demo product has a
 * Color × Size matrix; the selector's matching logic itself is covered at
 * the unit level (`variant-selection.test.ts`,
 * `product-detail.service.test.ts`), and here as a visitor uses it.
 */

const PRODUCT = '/ar/p/essential-crew-neck-tee';
const NAME = 'تيشيرت أساسي برقبة دائرية';

test.describe('product detail page', () => {
  test('renders gallery, price, stock and SKU from real data', async ({ page }) => {
    await page.goto(PRODUCT);
    await expect(page.getByRole('heading', { name: NAME })).toBeVisible();
    await expect(page.getByText('59.00')).toBeVisible();
    await expect(page.getByText('متوفر', { exact: true })).toBeVisible();
    // The first colour in its first size is the variant the page opens on.
    await expect(page.getByText('ESS-CREW-TEE-BLACK-S')).toBeVisible();
  });

  test('specifications read in English on the English page', async ({ page }) => {
    await page.goto('/en/p/essential-crew-neck-tee');
    await page.getByRole('tab', { name: 'Specifications' }).click();
    await expect(page.getByText('Cotton', { exact: true })).toBeVisible();
    await expect(page.getByText('Regular', { exact: true })).toBeVisible();
  });

  test('choosing a colour and a size selects that exact variant', async ({ page }) => {
    await page.goto(PRODUCT);
    const colour = page.getByRole('radiogroup', { name: 'اللون' });
    const size = page.getByRole('radiogroup', { name: 'المقاس' });
    // Sizes in the order the store listed them, not the order rows came back.
    await expect(size.getByRole('radio')).toHaveText(['S', 'M', 'L', 'XL']);

    await colour.getByRole('radio', { name: 'أبيض' }).click();
    await size.getByRole('radio', { name: 'L', exact: true }).click();
    await expect(colour.getByRole('radio', { name: 'أبيض' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(size.getByRole('radio', { name: 'L', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByText('ESS-CREW-TEE-WHITE-L')).toBeVisible();
  });

  test('gallery thumbnails switch the main image', async ({ page }) => {
    await page.goto(PRODUCT);
    // Scoped to the gallery — the colour and size pickers are radios too.
    const thumbs = page.getByRole('radiogroup', { name: 'صور المنتج' }).getByRole('radio');
    await expect(thumbs).toHaveCount(3);
    await expect(thumbs.nth(0)).toHaveAttribute('aria-checked', 'true');
    await thumbs.nth(1).click();
    await expect(thumbs.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(thumbs.nth(0)).toHaveAttribute('aria-checked', 'false');
  });

  test('description/specifications/reviews tabs switch content', async ({ page }) => {
    await page.goto(PRODUCT);
    await expect(page.getByText('قطن ممشّط متوسط الوزن')).toBeVisible();
    await page.getByRole('tab', { name: 'المواصفات' }).click();
    // Material and fit are stored in English and read in Arabic here.
    await expect(page.getByText('قطن', { exact: true })).toBeVisible();
    await expect(page.getByText('عادية', { exact: true })).toBeVisible();
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
    await page.goto(PRODUCT);
    await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
    // The toast renders its message twice on purpose — once visibly, once
    // in a screen-reader live region — so this targets the first.
    await expect(page.getByText('أُضيف إلى السلة').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'السلة' })).toContainText('1');
  });

  test('wishlist toggle persists across a reload (localStorage placeholder)', async ({ page }) => {
    await page.goto(PRODUCT);
    // Scoped to the purchase panel — "related products" below on the same
    // page render their own wishlist buttons with the same accessible name.
    const purchasePanel = page.locator('h1').locator('..');
    const wishlistButton = purchasePanel.getByRole('button', { name: 'أضف إلى المفضلة' });
    await wishlistButton.click();
    await expect(purchasePanel.getByRole('button', { name: 'إزالة من المفضلة' })).toBeVisible();
    await page.reload();
    await expect(purchasePanel.getByRole('button', { name: 'إزالة من المفضلة' })).toBeVisible();
  });

  test('related products link to other real, published products', async ({ page }) => {
    await page.goto(PRODUCT);
    const related = page.getByRole('heading', { name: 'منتجات ذات صلة' });
    await expect(related).toBeVisible();
    const relatedSection = page.locator('section', { has: related });
    await expect(relatedSection.getByRole('link').first()).toBeVisible();
  });

  test('visiting a product records it in "recently viewed" on another product page', async ({
    page,
  }) => {
    await page.goto(PRODUCT);
    await page.goto('/ar/p/classic-white-thobe');
    await expect(page.getByRole('heading', { name: 'شوهد مؤخرًا' })).toBeVisible();
    await expect(
      page
        .getByRole('heading', { name: 'شوهد مؤخرًا' })
        .locator('..')
        .getByRole('link', { name: new RegExp(NAME) }),
    ).toBeVisible();
  });
});
