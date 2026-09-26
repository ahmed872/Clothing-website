import { execSync } from 'node:child_process';

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { test as adminTest } from './fixtures/authenticated';
import { registerWithProfile } from './fixtures/customer-profile';
import { E2E_SIZING_FIXTURE } from './fixtures/sizing-fixture';

/**
 * Clothing P04 — the virtual fitting room, end to end: from the product
 * page's "Try it on" to the customer's own avatar wearing the chosen
 * garment, recommended size marked, colour and size switched live,
 * measurements changed and everything recalculated — in both languages, on
 * a phone, behind sign-in, and without breaking the cart.
 */

test.describe.configure({ timeout: 180_000 });

let ids: { fittingThobeId: string };

test.beforeAll(() => {
  const out = execSync('pnpm -s db:seed-e2e-sizing', { cwd: process.cwd(), encoding: 'utf8' });
  ids = JSON.parse(out.trim().split('\n').at(-1)!);
});

const TEE = E2E_SIZING_FIXTURE.fittingTee;
const THOBE = E2E_SIZING_FIXTURE.fittingThobe;
const ROOM = (locale: 'ar' | 'en', slug: string = TEE.slug) => `/${locale}/fitting-room/${slug}`;

const avatar = (page: Page) => page.getByTestId('fitting-avatar').locator('svg');
const garment = (page: Page) => avatar(page).locator('[data-part="garment"]');
const inGroup = (page: Page, group: string, name: string | RegExp) =>
  page
    .getByRole('radiogroup', { name: group })
    .getByRole('radio', typeof name === 'string' ? { name, exact: true } : { name });

async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).include('body').exclude('nextjs-portal').analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test('the journey: product → Try it on → my avatar in the garment → colour → size → new measurements', async ({
  page,
}) => {
  await registerWithProfile(page, 'en');

  // 1–2. From the product page.
  await page.goto(`/en/p/${TEE.slug}`, { waitUntil: 'networkidle' });
  // The size chosen on the product page travels with "Try it on".
  await page.getByRole('button', { name: 'Select size M' }).click();
  await page.getByTestId('try-it-on').click();
  await page.waitForURL(/\/en\/fitting-room\/e2e-fitting-tee\?/);

  // 3–4. The avatar is mine: my height, my proportions.
  await expect(avatar(page)).toBeVisible();
  await expect(avatar(page)).toHaveAttribute('data-height-cm', '177');
  await expect(avatar(page)).toHaveAttribute('data-renderer', 'local');

  // 5–6. The recommended size is marked, and the garment is on.
  const relation = page.getByTestId('fitting-relation');
  await expect(relation).toContainText('Recommended for you: M');
  await expect(inGroup(page, 'Size', 'M · Recommended')).toHaveAttribute('aria-checked', 'true');
  await expect(garment(page)).toHaveAttribute('data-garment', 'T_SHIRT');
  await expect(garment(page)).toHaveAttribute('data-size', 'M');
  await expect(page.getByTestId('fitting-areas')).toContainText('Chest matches');

  // 7. Colour: the garment changes, the page does not reload.
  const marker = await page.evaluate(
    () => ((window as unknown as { __marker: number }).__marker = 1),
  );
  expect(marker).toBe(1);
  await inGroup(page, 'Colour', 'Sand').click();
  await expect(garment(page).locator('path').first()).toHaveAttribute('fill', /#D8C4A2/i);
  await expect(page).toHaveURL(/color=/);
  expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);

  // 8. Size: my choice, with how it relates to the recommendation.
  await inGroup(page, 'Size', 'S').click();
  await expect(garment(page)).toHaveAttribute('data-size', 'S');
  await expect(relation).toContainText('You selected S');
  await expect(relation).toContainText('This is one size smaller than your recommended size.');
  await inGroup(page, 'Size', 'XL').click();
  await expect(relation).toContainText('This is two sizes larger than your recommended size.');
  await page.getByRole('button', { name: 'Use recommended size' }).click();
  await expect(garment(page)).toHaveAttribute('data-size', 'M');

  // 9–10. New measurements, recalculated by the server.
  await page.getByRole('button', { name: 'Adjust measurements' }).click();
  const dialog = page.getByRole('dialog', { name: 'Adjust your measurements' });
  await dialog.getByRole('textbox', { name: 'Chest (cm)', exact: true }).fill('102');
  await dialog.getByRole('button', { name: 'Save and recalculate' }).click();
  await expect(
    page.getByText('Your measurements were updated and recalculated.').first(),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(relation).toContainText('Recommended for you: L', { timeout: 20_000 });
  await expect(relation).toContainText('This is one size smaller than your recommended size.');

  // The profile really changed — not just this page.
  await page.goto('/en/account/body-profile', { waitUntil: 'networkidle' });
  await expect(page.getByRole('textbox', { name: 'Chest (cm)', exact: true })).toHaveValue('102');
});

test('a fit preference recalculates on the server; a thobe is drawn full length', async ({
  page,
}) => {
  await registerWithProfile(page, 'en');
  await page.goto(ROOM('en'), { waitUntil: 'networkidle' });
  await inGroup(page, 'Fit', 'Relaxed').click();
  await expect(page).toHaveURL(/fit=RELAXED/);
  await expect(page.getByTestId('fitting-relation')).toContainText('Recommended for you: XL');

  await page.goto(ROOM('en', THOBE.slug), { waitUntil: 'networkidle' });
  await expect(garment(page)).toHaveAttribute('data-garment', 'THOBE');
  const layers = await avatar(page).getAttribute('data-layers');
  expect(layers).not.toContain('base:bottom');
  expect(layers).not.toContain('base:top');
});

test('Arabic: right to left, in Arabic, with the relation said properly', async ({ page }) => {
  await registerWithProfile(page, 'ar');
  await page.goto(ROOM('ar'), { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'غرفة القياس', level: 1 })).toBeVisible();
  const relation = page.getByTestId('fitting-relation');
  await expect(relation).toContainText('المقاس المقترح لك: M');
  await inGroup(page, 'المقاس', 'L').click();
  await expect(relation).toContainText('هذا المقاس أكبر بمقاس واحد من المقاس المقترح لك.');
  await expect(avatar(page).locator('desc')).toContainText('تيشيرت غرفة القياس');
  await axe(page);
});

test('English, dark mode: accessible', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await registerWithProfile(page, 'en');
  await page.goto(ROOM('en'), { waitUntil: 'networkidle' });
  await expect(garment(page)).toBeVisible();
  await expect(avatar(page).locator('desc')).toContainText('Fitting Room Tee, Black, size M');
  await axe(page);
});

test('on a phone: stacked, and nothing scrolls sideways (en and ar)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await registerWithProfile(page, 'en');
  for (const locale of ['en', 'ar'] as const) {
    await page.goto(ROOM(locale), { waitUntil: 'networkidle' });
    await expect(garment(page)).toBeVisible();
    const box = await avatar(page).boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  }
});

test('signed out: sent to sign in, and brought back to the same fitting', async ({ page }) => {
  await page.goto(`${ROOM('en')}?size=nope`);
  await expect(page).toHaveURL(/\/en\/account\/login\?next=/);
  expect(decodeURIComponent(page.url())).toContain('/en/fitting-room/e2e-fitting-tee');
  await expect(page.getByTestId('fitting-avatar')).toHaveCount(0);
});

test('no profile: invited to create one, on the product page and in the fitting room', async ({
  page,
}) => {
  await registerWithProfile(page, 'en', { profile: false });
  await page.goto(`/en/p/${TEE.slug}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('size-recommendation-cta')).toContainText(
    'Create your fit profile',
  );
  await expect(page.getByTestId('try-it-on')).toHaveCount(0);
  await page.goto(ROOM('en'), { waitUntil: 'networkidle' });
  await expect(page.getByTestId('fitting-no-profile')).toContainText(
    'Create your fit profile first',
  );
});

test('the cart still works: add the chosen size from the fitting room', async ({ page }) => {
  await registerWithProfile(page, 'en');
  await page.goto(ROOM('en'), { waitUntil: 'networkidle' });
  await inGroup(page, 'Size', 'L').click();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('Added to your cart').first()).toBeVisible({ timeout: 20_000 });
  await page.goto('/en/cart', { waitUntil: 'networkidle' });
  await expect(page.getByText('Fitting Room Tee').first()).toBeVisible();
  await expect(page.getByText(/Black \/ L|L \/ Black/).first()).toBeVisible();
});

adminTest(
  'the admin sets how a garment is drawn, and the fitting room follows',
  async ({ ownerContext, browser }) => {
    execSync('pnpm db:seed-e2e-admins', { cwd: process.cwd(), stdio: 'ignore' });
    await ownerContext.addCookies([
      { name: 'clothing-locale', value: 'en', url: 'http://127.0.0.1:3000' },
    ]);
    const admin = await ownerContext.newPage();
    await admin.goto(`/admin/products/${ids.fittingThobeId}`, { waitUntil: 'networkidle' });
    const section = admin.getByTestId('fitting-appearance');
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByLabel('Swatch — White')).toHaveValue(/#F4F2EC/i);

    // A malformed colour is refused beside its field.
    await section.getByLabel('Swatch — White').fill('white');
    await admin.getByRole('button', { name: 'Save sizing' }).click();
    await expect(section.getByText('Not a colour — use #RRGGBB')).toBeVisible();

    await section.getByLabel('Swatch — White').fill(`#${THOBE.colors[0]!.swatch}`);
    await section.getByLabel('Pattern').click();
    await admin.getByRole('option', { name: 'Striped', exact: true }).click();
    await admin.getByRole('button', { name: 'Save sizing' }).click();
    await expect(admin.getByText('Sizing saved.').first()).toBeVisible({ timeout: 20_000 });

    const shopper = await browser.newPage();
    try {
      await registerWithProfile(shopper, 'en');
      await shopper.goto(ROOM('en', THOBE.slug), { waitUntil: 'networkidle' });
      await expect(garment(shopper).locator('pattern')).toHaveCount(1);
    } finally {
      await shopper.close();
    }

    // Back to the default, so the fixture is as it was.
    await admin.reload({ waitUntil: 'networkidle' });
    await admin.getByTestId('fitting-appearance').getByLabel('Pattern').click();
    await admin.getByRole('option', { name: /^Default/ }).click();
    await admin.getByRole('button', { name: 'Save sizing' }).click();
    await expect(admin.getByText('Sizing saved.').first()).toBeVisible({ timeout: 20_000 });
  },
);
