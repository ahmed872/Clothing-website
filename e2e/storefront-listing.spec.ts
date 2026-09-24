import { expect, test } from '@playwright/test';

/** Product listing: filters, sort, pagination, and empty states — against
 * the real seeded catalog (6 products in Women, filterable by brand,
 * material and fit; one product elsewhere on a real 20% sale). */

test.describe('product listing — filters, sort, pagination', () => {
  test('shows every published product with a working result count', async ({ page }) => {
    await page.goto('/ar/c/women');
    await expect(page.getByText('6 نتيجة')).toBeVisible();
  });

  test('brand filter narrows the grid via a real navigation', async ({ page }) => {
    await page.goto('/ar/c/women');
    // A plain `.click()`, not `.check()`: the checkbox is a Radix
    // `role="checkbox"` controlled entirely by the URL (checking it fires a
    // client-side navigation and the server re-renders it checked once the
    // new page's props say so) — `.check()`'s built-in post-click assertion
    // re-queries too eagerly for that async round trip.
    await page.getByRole('checkbox', { name: 'تراث' }).click();
    await expect(page).toHaveURL(/brand=heritage/);
    await expect(page.getByRole('checkbox', { name: 'تراث' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByText('1 نتيجة')).toBeVisible();
    await expect(page.getByRole('link', { name: /عباية سوداء كلاسيكية/ }).first()).toBeVisible();
  });

  test('an attribute filter reads in Arabic but filters by the stored value', async ({ page }) => {
    await page.goto('/ar/c/women');
    await page.getByRole('checkbox', { name: 'قطن' }).click();
    await expect(page).toHaveURL(/attr_material=Cotton/);
    await expect(page.getByRole('checkbox', { name: 'قطن' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByText('1 نتيجة')).toBeVisible();
    await expect(page.getByRole('link', { name: /تيشيرت قطني واسع/ }).first()).toBeVisible();
    // No English value leaks into the Arabic filter list.
    await expect(page.getByRole('checkbox', { name: 'Cotton' })).toHaveCount(0);
  });

  test('in-stock-only filter and clear-filters round-trip', async ({ page }) => {
    await page.goto('/ar/c/women');
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
    await page.goto('/ar/c/women');
    await page.getByRole('combobox', { name: 'الترتيب' }).click();
    await page.getByRole('option', { name: 'السعر: من الأقل للأعلى' }).click();
    await expect(page).toHaveURL(/sort=price-asc/);
    const firstCardPrice = page
      .locator('main')
      .getByText(/ر\.س\./)
      .first();
    await expect(firstCardPrice).toContainText('69.00');
  });

  test('search with no matches shows the empty-results state, not a crash', async ({ page }) => {
    await page.goto('/ar/search?q=zzzznonexistentproductzzzz');
    await expect(page.getByText('لا توجد نتائج')).toBeVisible();
  });

  test('active offers rail on the homepage shows the real discount badge', async ({ page }) => {
    await page.goto('/ar');
    const offerCard = page.getByRole('link', { name: /جينز بقَصّة ضيقة/ }).first();
    await expect(offerCard).toBeVisible();
    await expect(page.getByText('-20%').first()).toBeVisible();
  });
});
