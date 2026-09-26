import { expect, type Page } from '@playwright/test';

/**
 * A new storefront customer with a saved body profile — the starting point
 * of every fitting-room (P04) and try-on (P05) spec. Registers through the
 * real form and saves the profile through the real page, in either
 * language; `profile: false` stops after registering.
 */
export async function registerWithProfile(
  page: Page,
  locale: 'ar' | 'en',
  { chest = '97', profile = true, prefix = 'p04' } = {},
): Promise<void> {
  const email = `${prefix}-${locale}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
  await page.goto(`/${locale}/account/register`);
  const form = page.locator('main form');
  await form.locator('input[name="name"]').fill('Fitting Tester');
  await form.locator('input[name="email"]').fill(email);
  await form.locator('input[name="password"]').fill('Password123');
  await form.locator('input[name="passwordConfirmation"]').fill('Password123');
  await form.locator('button[type="submit"]').click();
  await page.waitForURL(/\/account$/, { timeout: 30_000 });
  if (!profile) return;
  await page.goto(`/${locale}/account/body-profile`, { waitUntil: 'networkidle' });
  const ar = locale === 'ar';
  const field = (en: string, arName: string) =>
    page.getByRole('textbox', { name: ar ? arName : en, exact: true });
  await page.getByRole('radio', { name: ar ? 'ذكر' : 'Male', exact: true }).click();
  await field('Height (cm)', 'الطول (سم)').fill('177');
  await field('Weight (kg)', 'الوزن (كجم)').fill('78');
  await field('Waist (cm)', 'محيط الخصر (سم)').fill('84');
  await field('Chest (cm)', 'محيط الصدر (سم)').fill(chest);
  await field('Shoulder width (cm)', 'عرض الكتفين (سم)').fill('45');
  await page.getByRole('button', { name: ar ? 'حفظ الملف' : 'Save profile' }).click();
  await expect(
    page.getByText(ar ? 'تم حفظ ملف المقاسات' : 'Fit profile saved').first(),
  ).toBeVisible({
    timeout: 20_000,
  });
}
