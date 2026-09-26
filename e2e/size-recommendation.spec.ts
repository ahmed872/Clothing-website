import { execSync } from 'node:child_process';

import AxeBuilder from '@axe-core/playwright';
import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './fixtures/authenticated';
import { E2E_SIZING_FIXTURE } from './fixtures/sizing-fixture';

/**
 * Clothing P02 — the size recommendation, end to end: an admin building a
 * size chart in the product editor, and customers reading their
 * recommendation on the product page — before and after a fit profile,
 * after changing it, with another fit, in Arabic and English, on a phone,
 * and never seeing another customer's.
 */

test.describe.configure({ timeout: 180_000 });

let ids: { teeId: string; shirtId: string };

test.beforeAll(() => {
  execSync('pnpm db:seed-e2e-admins', { cwd: process.cwd(), stdio: 'inherit' });
  const out = execSync('pnpm -s db:seed-e2e-sizing', { cwd: process.cwd(), encoding: 'utf8' });
  ids = JSON.parse(out.trim().split('\n').at(-1)!);
});

const BASE = 'http://127.0.0.1:3000';
const TEE = (locale: 'ar' | 'en') => `/${locale}/p/${E2E_SIZING_FIXTURE.tee.slug}`;
const SHIRT = (locale: 'ar' | 'en') => `/${locale}/p/${E2E_SIZING_FIXTURE.adminShirt.slug}`;
const PASSWORD = 'Password123';

async function registerAndSignIn(page: Page, locale: 'ar' | 'en'): Promise<void> {
  const email = `p02-${locale}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
  await page.goto(`/${locale}/account/register`);
  const form = page.locator('main form');
  await form.locator('input[name="name"]').fill(locale === 'ar' ? 'عميل المقاسات' : 'Size Tester');
  await form.locator('input[name="email"]').fill(email);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await form.locator('input[name="passwordConfirmation"]').fill(PASSWORD);
  await form.locator('button[type="submit"]').click();
  await page.waitForURL(/\/account$/, { timeout: 30_000 });
}

const field = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });

/** Fills the English fit profile form and saves it. */
async function saveProfile(
  page: Page,
  values: { chest: string; shoulder?: string; fit?: 'Slim' | 'Regular' | 'Relaxed' },
): Promise<void> {
  await page.goto('/en/account/body-profile', { waitUntil: 'networkidle' });
  await page.getByRole('radio', { name: 'Male', exact: true }).click();
  await field(page, 'Height (cm)').fill('177');
  await field(page, 'Weight (kg)').fill('78');
  await field(page, 'Waist (cm)').fill('84');
  await field(page, 'Chest (cm)').fill(values.chest);
  await field(page, 'Shoulder width (cm)').fill(values.shoulder ?? '45');
  if (values.fit) await page.getByRole('radio', { name: values.fit, exact: true }).click();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Fit profile saved').first()).toBeVisible({ timeout: 20_000 });
}

async function openProduct(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('size-recommendation-panel')).toBeVisible({ timeout: 60_000 });
}

const recommended = (page: Page) => page.getByTestId('recommended-size');
const sizeRadio = (page: Page, size: string, group = 'Size') =>
  page.getByRole('radiogroup', { name: group }).getByRole('radio', { name: size, exact: true });

async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).include('body').exclude('nextjs-portal').analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test('a signed-out visitor is invited to create a fit profile, and can read the size chart', async ({
  page,
}) => {
  await openProduct(page, TEE('en'));
  const cta = page.getByTestId('size-recommendation-cta');
  await expect(cta).toContainText('Know your size before you buy');
  await expect(cta.getByRole('link', { name: 'Create your fit profile' })).toHaveAttribute(
    'href',
    `/en/account/login?next=${encodeURIComponent('/en/account/body-profile')}`,
  );
  await expect(recommended(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Size chart' }).click();
  const dialog = page.getByRole('dialog', { name: 'Size chart' });
  await expect(dialog.getByRole('columnheader', { name: 'Chest (cm)' })).toBeVisible();
  await expect(dialog.getByRole('row', { name: /^M\b/ })).toContainText('107');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('the customer journey: no profile → recommendation → select it → another fit → profile changes', async ({
  page,
}) => {
  await registerAndSignIn(page, 'en');
  await openProduct(page, TEE('en'));
  await expect(page.getByTestId('size-recommendation-cta')).toContainText(
    'Add your measurements once',
  );

  // Chest 97 + 10 cm regular ease = 107: size M exactly.
  await saveProfile(page, { chest: '97' });
  await openProduct(page, TEE('en'));
  await expect(recommended(page)).toHaveText('Your recommended size: M');
  await expect(page.locator('[data-confidence]')).toHaveText('High confidence');
  const reasons = page.getByTestId('size-recommendation-reasons');
  await expect(reasons.getByRole('listitem')).toHaveText([
    'Chest matches',
    'Shoulder matches',
    'Regular fit preference',
  ]);
  await expect(page.getByTestId('size-recommendation-alternatives')).toHaveText('L — looser fit');

  // The customer chooses; the recommendation only helps.
  await page.getByRole('button', { name: 'Select size M' }).click();
  await expect(sizeRadio(page, 'M')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Size M selected')).toBeVisible();

  // Another fit, for this page only.
  await page.getByRole('radio', { name: 'Relaxed', exact: true }).click();
  await expect(recommended(page)).toHaveText('Your recommended size: XL');
  await expect(reasons).toContainText('Relaxed fit preference');

  // A bigger chest in the profile → a bigger recommendation.
  await saveProfile(page, { chest: '102' });
  await openProduct(page, TEE('en'));
  await expect(recommended(page)).toHaveText('Your recommended size: L');

  // A slim preference saved in the profile is the page's default.
  await saveProfile(page, { chest: '100', fit: 'Slim' });
  await openProduct(page, TEE('en'));
  await expect(recommended(page)).toHaveText('Your recommended size: M');
  await expect(page.getByRole('radio', { name: 'Slim', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // Without a chest measurement there is no guess — it says what is missing.
  await page.goto('/en/account/body-profile', { waitUntil: 'networkidle' });
  await field(page, 'Chest (cm)').fill('');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Fit profile saved').first()).toBeVisible({ timeout: 20_000 });
  await openProduct(page, TEE('en'));
  await expect(page.getByTestId('size-recommendation-insufficient')).toContainText(
    'Add your chest measurement to get a recommendation for this T-shirt.',
  );
  await expect(recommended(page)).toHaveCount(0);
});

test('Arabic: right-to-left, the recommendation and its reasons in Arabic', async ({ page }) => {
  await registerAndSignIn(page, 'ar');
  await page.goto('/ar/account/body-profile', { waitUntil: 'networkidle' });
  await page.getByRole('radio', { name: 'ذكر', exact: true }).click();
  await field(page, 'الطول (سم)').fill('١٧٧');
  await field(page, 'الوزن (كجم)').fill('78');
  await field(page, 'محيط الخصر (سم)').fill('84');
  await field(page, 'محيط الصدر (سم)').fill('97');
  await field(page, 'عرض الكتفين (سم)').fill('45');
  await page.getByRole('button', { name: 'حفظ الملف' }).click();
  await expect(page.getByText('تم حفظ ملف المقاسات').first()).toBeVisible({ timeout: 20_000 });

  await openProduct(page, TEE('ar'));
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(recommended(page)).toHaveText('مقاسك المقترح: M');
  await expect(page.getByTestId('size-recommendation-reasons').getByRole('listitem')).toHaveText([
    'قياس الصدر: مناسب',
    'قياس الأكتاف: مناسب',
    'حسب تفضيلك للقَصّة العادية',
  ]);
  await expect(page.getByTestId('size-recommendation-alternatives')).toHaveText('L — أوسع قليلًا');
  await page.getByRole('button', { name: 'اختر المقاس M' }).click();
  await expect(sizeRadio(page, 'M', 'المقاس')).toHaveAttribute('aria-checked', 'true');
  await axe(page);
});

test('one customer never sees another’s recommendation', async ({ browser }) => {
  const contexts: BrowserContext[] = [];
  try {
    const a = await browser.newContext();
    const b = await browser.newContext();
    contexts.push(a, b);
    const pageA = await a.newPage();
    const pageB = await b.newPage();

    await registerAndSignIn(pageA, 'en');
    await saveProfile(pageA, { chest: '97' });
    await registerAndSignIn(pageB, 'en');

    await openProduct(pageA, TEE('en'));
    await expect(recommended(pageA)).toHaveText('Your recommended size: M');
    await openProduct(pageB, TEE('en'));
    await expect(pageB.getByTestId('size-recommendation-cta')).toBeVisible();
    await expect(recommended(pageB)).toHaveCount(0);
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('on a phone: the panel fits, nothing scrolls sideways (en and ar)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await registerAndSignIn(page, 'en');
  await saveProfile(page, { chest: '97' });
  for (const locale of ['en', 'ar'] as const) {
    await openProduct(page, TEE(locale));
    await expect(recommended(page)).toBeVisible();
    await page.getByTestId('size-recommendation-panel').scrollIntoViewIfNeeded();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
  }
});

test('accessibility: the recommendation in dark mode, and the size chart dialog', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await registerAndSignIn(page, 'en');
  await saveProfile(page, { chest: '99.5', shoulder: '' });
  await openProduct(page, TEE('en'));
  // Between M and L: medium confidence, and it says so.
  await expect(page.getByTestId('size-recommendation-reasons')).toContainText(
    'You are between sizes — L is close too',
  );
  await axe(page);
  await page.getByRole('button', { name: 'Size chart' }).click();
  await expect(page.getByRole('dialog', { name: 'Size chart' })).toBeVisible();
  await axe(page);
});

test('the admin builds a size chart, and it reaches the product page', async ({ ownerContext }) => {
  await ownerContext.addCookies([{ name: 'clothing-locale', value: 'en', url: BASE }]);
  const admin = await ownerContext.newPage();
  await admin.goto(`/admin/products/${ids.shirtId}`, { waitUntil: 'networkidle' });
  const editor = admin.getByTestId('size-chart-editor');
  await editor.scrollIntoViewIfNeeded();

  // A previous run's chart goes first, through the same editor.
  const remove = editor.getByRole('button', { name: 'Remove sizing' });
  if (await remove.isVisible()) {
    await remove.click();
    await admin.getByRole('dialog').getByRole('button', { name: 'Remove sizing' }).click();
    await expect(admin.getByText('Sizing removed.').first()).toBeVisible({ timeout: 20_000 });
  }

  await admin.getByLabel('Garment type').click();
  await admin.getByRole('option', { name: 'Shirt', exact: true }).click();
  await expect(admin.getByLabel('Size option')).toContainText('Size');
  await editor.getByRole('button', { name: 'Add all sizes' }).click();
  const chest = { S: '100', M: '106', L: '112' };
  for (const [size, value] of Object.entries(chest)) {
    await admin.getByLabel(`Chest — size ${size} (cm)`).fill(value);
    await admin.getByLabel(`Shoulder — size ${size} (cm)`).fill(String(Number(value) / 2 - 7));
  }
  // An impossible value is refused beside its cell, and nothing is saved.
  await admin.getByLabel('Chest — size L (cm)').fill('-112');
  await editor.getByRole('button', { name: 'Save sizing' }).click();
  await expect(editor.getByTestId('size-chart-error')).toHaveText(
    'Check the highlighted cells in the chart.',
  );
  await expect(admin.getByLabel('Chest — size L (cm)')).toHaveAttribute('aria-invalid', 'true');

  // Reorder, then fix and save; the preview shows the shopper's view.
  await editor.getByRole('button', { name: 'Move L up' }).click();
  await editor.getByRole('button', { name: 'Move L down' }).click();
  await admin.getByLabel('Chest — size L (cm)').fill('112');
  await editor.getByRole('button', { name: 'Preview as shoppers see it' }).click();
  await expect(
    editor.getByTestId('size-chart-preview').getByRole('row', { name: /^M\b/ }),
  ).toContainText('106');
  await editor.getByRole('button', { name: 'Save sizing' }).click();
  await expect(admin.getByText('Sizing saved.').first()).toBeVisible({ timeout: 20_000 });
  await expect(editor.getByTestId('size-chart-unsaved')).toHaveCount(0);

  // Reload: it is stored.
  await admin.reload({ waitUntil: 'networkidle' });
  await expect(admin.getByLabel('Chest — size M (cm)')).toHaveValue('106');

  // The storefront reads the same chart.
  const shopper = await ownerContext.browser()!.newPage();
  try {
    await openProduct(shopper, SHIRT('en'));
    await shopper.getByRole('button', { name: 'Size chart' }).click();
    const dialog = shopper.getByRole('dialog', { name: 'Size chart' });
    await expect(dialog.getByRole('row', { name: /^L\b/ })).toContainText('112');
  } finally {
    await shopper.close();
  }
});
