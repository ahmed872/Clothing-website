import { expect, test } from '@playwright/test';

/** Product listing: filters, sort, pagination, and empty states — against
 * the real seeded catalog (12 cars, one filterable by brand/fuel_type/
 * transmission, one on a real 10% sale). */

test.describe('product listing — filters, sort, pagination', () => {
  test('shows every published product with a working result count', async ({ page }) => {
    await page.goto('/ar/c/cars');
    await expect(page.getByText('12 نتيجة')).toBeVisible();
  });

  test('brand filter narrows the grid via a real navigation', async ({ page }) => {
    await page.goto('/ar/c/cars');
    // A plain `.click()`, not `.check()`: the checkbox is a Radix
    // `role="checkbox"` controlled entirely by the URL (checking it fires a
    // client-side navigation and the server re-renders it checked once the
    // new page's props say so) — `.check()`'s built-in post-click assertion
    // re-queries too eagerly for that async round trip.
    await page.getByRole('checkbox', { name: 'Tesla' }).click();
    await expect(page).toHaveURL(/brand=tesla/);
    await expect(page.getByRole('checkbox', { name: 'Tesla' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByText('1 نتيجة')).toBeVisible();
    await expect(page.getByRole('link', { name: /Tesla Model S/i }).first()).toBeVisible();
  });

  test('in-stock-only filter and clear-filters round-trip', async ({ page }) => {
    await page.goto('/ar/c/cars');
    await page.getByRole('checkbox', { name: 'المتوفر فقط' }).click();
    await expect(page).toHaveURL(/inStock=1/);
    await expect(page.getByRole('checkbox', { name: 'المتوفر فقط' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.getByRole('button', { name: 'مسح الفلاتر' }).click();
    await expect(page).not.toHaveURL(/inStock=1/);
  });

  test('sort by price ascending actually reorders results', async ({ page }) => {
    await page.goto('/ar/c/cars');
    await page.getByRole('combobox', { name: 'الترتيب' }).click();
    await page.getByRole('option', { name: 'السعر: من الأقل للأعلى' }).click();
    await expect(page).toHaveURL(/sort=price-asc/);
    const firstCardPrice = page
      .locator('main')
      .getByText(/ر\.س\./)
      .first();
    await expect(firstCardPrice).toContainText('68,000');
  });

  test('search with no matches shows the empty-results state, not a crash', async ({ page }) => {
    await page.goto('/ar/search?q=zzzznonexistentproductzzzz');
    await expect(page.getByText('لا توجد نتائج')).toBeVisible();
  });

  test('active offers rail on the homepage shows the real discount badge', async ({ page }) => {
    await page.goto('/ar');
    const offerCard = page.getByRole('link', { name: /BMW 7 Series/i }).first();
    await expect(offerCard).toBeVisible();
    await expect(page.getByText('-10%').first()).toBeVisible();
  });
});
