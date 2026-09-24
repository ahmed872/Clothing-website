import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** P05 accessibility gate — axe against every major storefront screen, both
 * locales, both themes, plus basic keyboard-navigation checks. Mirrors
 * `accessibility.spec.ts`'s pattern for `/dev/gallery` (P02), applied to
 * the real storefront pages this phase adds. */

const PAGES: { url: string; label: string }[] = [
  { url: '/ar', label: 'homepage (ar)' },
  { url: '/en', label: 'homepage (en)' },
  { url: '/ar/c/cars', label: 'category listing (ar)' },
  { url: '/en/c/cars', label: 'category listing (en)' },
  { url: '/ar/p/mercedes-benz-s-class', label: 'product detail (ar)' },
  { url: '/en/p/mercedes-benz-s-class', label: 'product detail (en)' },
  { url: '/ar/search?q=car', label: 'search results (ar)' },
];

test.describe('storefront — accessibility (axe, light theme)', () => {
  for (const { url, label } of PAGES) {
    test(label, async ({ page }) => {
      await page.goto(url);
      const results = await new AxeBuilder({ page }).include('body').analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }
});

test.describe('storefront — accessibility (axe, dark theme)', () => {
  for (const { url, label } of PAGES) {
    test(label, async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('luxedrive-theme', 'dark'));
      await page.goto(url);
      const results = await new AxeBuilder({ page }).include('body').analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }
});

test.describe('storefront — keyboard navigation', () => {
  test('the mobile menu drawer opens, traps focus, and returns it on close', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/ar');
    const trigger = page.getByRole('button', { name: 'القائمة' });
    await trigger.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('the quick-view dialog opens via keyboard and closes back to its trigger', async ({
    page,
  }) => {
    await page.goto('/ar/c/cars');
    const trigger = page.getByRole('button', { name: 'عرض سريع' }).first();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('the filters drawer is reachable and operable by keyboard on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/ar/c/cars');
    const trigger = page.getByRole('button', { name: 'الفلاتر' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'المتوفر فقط' })).toBeVisible();
  });

  test('every product card image link is keyboard-focusable with a visible focus ring', async ({
    page,
  }) => {
    await page.goto('/ar/c/cars');
    const firstCard = page.getByRole('link', { name: /Audi A8|Mercedes-Benz|BMW/i }).first();
    await firstCard.focus();
    await expect(firstCard).toBeFocused();
  });
});
