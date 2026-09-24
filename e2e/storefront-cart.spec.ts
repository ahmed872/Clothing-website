import { expect, test, type Page } from '@playwright/test';

/**
 * The cart journey (P09 §27), against the seeded catalog.
 *
 * Each test gets its own browser context, so each is a fresh guest with its
 * own cookie — which is also what makes the isolation checks meaningful
 * rather than incidental.
 */

const PRODUCT = '/ar/p/mercedes-benz-s-class';
const PRODUCT_EN = '/en/p/mercedes-benz-s-class';

async function addOne(page: Page, url = PRODUCT): Promise<void> {
  await page.goto(url);
  const label = url.startsWith('/en') ? 'Add to cart' : 'أضف إلى السلة';
  await page.getByRole('button', { name: label }).click();
  await expect(
    page.getByText(url.startsWith('/en') ? 'Added to your cart' : 'أُضيف إلى السلة').first(),
  ).toBeVisible();
}

test.describe('cart — the basics', () => {
  test('an empty cart says so rather than showing a blank page', async ({ page }) => {
    await page.goto('/ar/cart');
    await expect(page.getByRole('heading', { name: 'سلة التسوق' })).toBeVisible();
    await expect(page.getByText('سلتك فارغة')).toBeVisible();
    await expect(page.getByRole('link', { name: 'متابعة التسوق' })).toBeVisible();
  });

  test('adding from a product page shows the line, priced from the catalog', async ({ page }) => {
    await addOne(page);
    await page.goto('/ar/cart');

    await expect(page.getByRole('link', { name: 'Mercedes-Benz S-Class' })).toBeVisible();
    // The seeded price, rendered by the server — not recomputed in the page.
    await expect(page.getByText('125,000.00').first()).toBeVisible();
  });

  test('the quantity cannot be raised past the stock the store actually has', async ({ page }) => {
    // This seeded variant has one unit. The stepper's ceiling comes from
    // the server's own availability, so the control is simply disabled
    // rather than offering a quantity the store cannot ship.
    await addOne(page);
    await page.goto('/ar/cart');

    await expect(page.getByRole('button', { name: 'زيادة الكمية' })).toBeDisabled();
  });

  test('removing a line empties the cart', async ({ page }) => {
    await addOne(page);
    await page.goto('/ar/cart');

    await page.getByRole('button', { name: /إزالة .* من السلة/ }).click();
    await expect(page.getByText('سلتك فارغة')).toBeVisible({ timeout: 15_000 });
  });

  test('clearing asks first, then empties', async ({ page }) => {
    await addOne(page);
    await page.goto('/ar/cart');

    await page.getByRole('button', { name: 'إفراغ السلة' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'إفراغ السلة' }).click();

    await expect(page.getByText('سلتك فارغة')).toBeVisible({ timeout: 15_000 });
  });

  test('the header badge follows the cart', async ({ page }) => {
    await page.goto(PRODUCT);
    const cartLink = page.getByRole('link', { name: 'السلة' });
    await expect(cartLink).not.toContainText('1');

    await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
    await expect(cartLink).toContainText('1', { timeout: 15_000 });
  });
});

test.describe('cart — promotions', () => {
  test('an invalid code is refused with a safe message and no discount', async ({ page }) => {
    await addOne(page);
    await page.goto('/ar/cart');

    await page.getByLabel('كود الخصم').fill('DEFINITELY-NOT-A-CODE');
    await page.getByRole('button', { name: 'تطبيق' }).click();

    // Scoped to the field's own error, not Next's route announcer, which
    // is also a live region.
    await expect(page.locator('#promo-error')).toContainText('غير صالح', { timeout: 15_000 });
    // No discount row appeared.
    await expect(page.getByText('الخصم', { exact: true })).toHaveCount(0);
  });

  test('the promotion field is keyboard reachable and labelled', async ({ page }) => {
    await addOne(page);
    await page.goto('/ar/cart');

    const field = page.getByLabel('كود الخصم');
    await field.focus();
    await expect(field).toBeFocused();
    await field.fill('X');
    await field.press('Enter');
    // Submitting by keyboard reaches the server and comes back with an answer.
    await expect(page.locator('#promo-error')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('cart — guest isolation', () => {
  test('a second browser context does not see the first cart', async ({ page, browser }) => {
    await addOne(page);
    await page.goto('/ar/cart');
    await expect(page.getByRole('link', { name: 'Mercedes-Benz S-Class' })).toBeVisible();

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto('/ar/cart');
    await expect(otherPage.getByText('سلتك فارغة')).toBeVisible();
    await other.close();
  });

  test('the guest cart cookie is httpOnly, so script cannot read it', async ({ page, context }) => {
    await addOne(page);

    const cookie = (await context.cookies()).find((c) => c.name === 'luxedrive-cart');
    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.sameSite).toBe('Lax');

    // And the page itself cannot see it.
    const visible = await page.evaluate(() => document.cookie);
    expect(visible).not.toContain('luxedrive-cart');
  });
});

test.describe('cart — both languages', () => {
  test('English renders LTR with the same server totals', async ({ page }) => {
    await addOne(page, PRODUCT_EN);
    await page.goto('/en/cart');

    await expect(page.getByRole('heading', { name: 'Shopping cart' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByText('125,000.00').first()).toBeVisible();
  });

  test('Arabic renders RTL, with Latin digits in the money', async ({ page }) => {
    await addOne(page);
    await page.goto('/ar/cart');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // ADR-023: prices read identically in both languages.
    await expect(page.getByText('125,000.00').first()).toBeVisible();
  });
});

test.describe('cart — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('is usable at 390px with no horizontal page scroll', async ({ page }) => {
    await addOne(page);
    await page.goto('/ar/cart');
    await expect(page.getByRole('heading', { name: 'سلة التسوق' })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // The quantity controls are real tap targets, not decorations.
    const increase = page.getByRole('button', { name: 'زيادة الكمية' });
    const box = await increase.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(32);
    expect(box!.width).toBeGreaterThanOrEqual(32);
  });
});
