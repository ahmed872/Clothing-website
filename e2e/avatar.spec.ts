import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * Clothing P03 — the layered avatar, in the browser: it follows
 * measurements and appearance live without saving, describes itself in the
 * page's language, fits a phone, passes axe in dark mode, and stops easing
 * when the customer asks for reduced motion.
 */

test.describe.configure({ timeout: 120_000 });

async function registerAndOpen(page: Page, locale: 'ar' | 'en'): Promise<void> {
  const email = `p03-${locale}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
  await page.goto(`/${locale}/account/register`);
  const form = page.locator('main form');
  await form.locator('input[name="name"]').fill('Avatar Tester');
  await form.locator('input[name="email"]').fill(email);
  await form.locator('input[name="password"]').fill('Password123');
  await form.locator('input[name="passwordConfirmation"]').fill('Password123');
  await form.locator('button[type="submit"]').click();
  await page.waitForURL(/\/account$/, { timeout: 30_000 });
  await page.goto(`/${locale}/account/body-profile`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('avatar-preview')).toBeVisible();
}

const avatar = (page: Page) => page.getByTestId('avatar-preview').locator('svg');
const field = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });
const inGroup = (page: Page, group: RegExp, name: string) =>
  page.getByRole('radiogroup', { name: group }).getByRole('radio', { name, exact: true });

test('the layered avatar follows the form live, before anything is saved', async ({ page }) => {
  await registerAndOpen(page, 'en');
  const svg = avatar(page);
  await expect(svg).toHaveAttribute('data-renderer', 'local');
  await expect(svg.locator('[data-layer="body"]')).toHaveCount(1);
  await expect(svg.locator('[data-part="hair"]')).toHaveCount(0);

  const torso = svg.locator('[data-part="body"] path').nth(2);
  await field(page, 'Height (cm)').fill('165');
  await field(page, 'Waist (cm)').fill('70');
  const narrow = await torso.getAttribute('d');
  await field(page, 'Waist (cm)').fill('96');
  await expect(torso).not.toHaveAttribute('d', narrow!);
  await expect(svg).toHaveAttribute('data-height-cm', '165');

  await inGroup(page, /Hair style/, 'Long').click();
  await expect(svg.locator('[data-part="hair"]')).toHaveCount(1);
  await inGroup(page, /Hair style/, 'Hijab / covered').click();
  await expect(svg.locator('[data-part="covering"]')).toHaveCount(1);
  await expect(svg.locator('[data-part="hair"]')).toHaveCount(0);
  await page.getByRole('switch', { name: 'I wear glasses' }).click();
  await expect(svg.locator('[data-part="glasses"]')).toHaveCount(1);

  // Nothing was saved: a reload shows the empty form again.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(field(page, 'Waist (cm)')).toHaveValue('');
  await expect(avatar(page).locator('[data-part="covering"]')).toHaveCount(0);
});

test('it describes its proportions in the page’s language — Arabic', async ({ page }) => {
  await registerAndOpen(page, 'ar');
  await field(page, 'الطول (سم)').fill('162');
  await field(page, 'محيط الخصر (سم)').fill('70');
  await field(page, 'محيط الصدر (سم)').fill('90');
  await field(page, 'محيط الورك (سم)').fill('100');
  const desc = avatar(page).locator('desc');
  await expect(desc).toContainText('الورك أعرض من الصدر');
  await expect(desc).toContainText('162');
  await expect(avatar(page)).toHaveAttribute('data-body-shape', 'HIPS_WIDER');
});

test('and in English, dark mode, with no accessibility violations', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await registerAndOpen(page, 'en');
  await field(page, 'Height (cm)').fill('180');
  await field(page, 'Waist (cm)').fill('80');
  await field(page, 'Chest (cm)').fill('104');
  await field(page, 'Hips (cm)').fill('96');
  await expect(avatar(page).locator('desc')).toContainText('chest wider than hips');
  const results = await new AxeBuilder({ page }).include('body').exclude('nextjs-portal').analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

test('on a phone it fits the screen, above the form', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await registerAndOpen(page, 'ar');
  const box = await avatar(page).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('shapes ease between changes — and not at all with reduced motion', async ({ page }) => {
  await registerAndOpen(page, 'en');
  const duration = () =>
    avatar(page)
      .locator('[data-part="body"] path')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(await duration()).toMatch(/0\.32s/);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await duration()).toMatch(/^1e-05s|^0\.00001s|^0s/);
});
