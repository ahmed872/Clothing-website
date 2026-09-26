import { execSync } from 'node:child_process';

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { registerWithProfile } from './fixtures/customer-profile';
import { E2E_SIZING_FIXTURE } from './fixtures/sizing-fixture';

/**
 * Clothing P05 — optional AI try-on, end to end, on the development
 * server's configured provider: the labelled **mock** (`AI_TRYON_PROVIDER=
 * "mock"` in the local `.env`, as `PAYMENT_PROVIDER` is set for the payment
 * specs). The mock generates no image; these tests prove the page says so,
 * asks for consent every time, follows the job to the end, lets the
 * customer cancel, and never shows one customer's job to another. The
 * "switched off" state is covered by `try-on-panel.test.tsx` and the
 * actions' security tests, since one server runs one configuration.
 */

test.describe.configure({ timeout: 180_000 });

test.beforeAll(() => {
  execSync('pnpm -s db:seed-e2e-sizing', { cwd: process.cwd(), encoding: 'utf8' });
});

const ROOM = (locale: 'ar' | 'en') =>
  `/${locale}/fitting-room/${E2E_SIZING_FIXTURE.fittingTee.slug}`;

const panel = (page: Page) => page.getByTestId('try-on-panel');

async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).include('body').exclude('nextjs-portal').analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test('asks for consent, runs on the mock, and never calls the outcome an AI image', async ({
  page,
}) => {
  await registerWithProfile(page, 'en', { prefix: 'p05' });
  await page.goto(ROOM('en'), { waitUntil: 'networkidle' });

  await expect(panel(page).getByTestId('try-on-mock-badge')).toHaveText('Mock provider');
  await expect(panel(page).getByTestId('try-on-mock-notice')).toContainText(
    'No AI image is generated',
  );

  const start = panel(page).getByRole('button', { name: 'Try on with AI' });
  await expect(start).toBeDisabled();
  await panel(page).getByRole('checkbox').click();
  await expect(start).toBeEnabled();
  await start.click();

  const status = panel(page).getByTestId('try-on-status');
  await expect(status).toContainText('Your try-on is ready.', { timeout: 20_000 });
  await expect(panel(page).getByTestId('try-on-mock-result')).toContainText(
    'No AI image was generated',
  );
  await expect(panel(page).locator('img')).toHaveCount(0);

  // Consent was for that request: the next one asks again.
  await expect(panel(page).getByRole('checkbox')).not.toBeChecked();
  await expect(start).toBeDisabled();
});

test('the customer can cancel a running try-on (Arabic)', async ({ page }) => {
  await registerWithProfile(page, 'ar', { prefix: 'p05' });
  await page.goto(ROOM('ar'), { waitUntil: 'networkidle' });
  await expect(panel(page).getByTestId('try-on-mock-badge')).toHaveText('مزوّد تجريبي');

  await panel(page).getByRole('checkbox').click();
  await panel(page).getByRole('button', { name: 'جرّبها بالذكاء الاصطناعي' }).click();
  await panel(page).getByRole('button', { name: 'إلغاء' }).click();
  await expect(panel(page).getByTestId('try-on-status')).toContainText('ألغيت هذه التجربة.');
});

test('one customer’s job does not exist for another', async ({ browser }) => {
  const owner = await browser.newContext();
  const ownerPage = await owner.newPage();
  await registerWithProfile(ownerPage, 'en', { prefix: 'p05' });
  await ownerPage.goto(ROOM('en'), { waitUntil: 'networkidle' });
  await panel(ownerPage).getByRole('checkbox').click();
  await panel(ownerPage).getByRole('button', { name: 'Try on with AI' }).click();
  const status = panel(ownerPage).getByTestId('try-on-status');
  await expect(status).toHaveAttribute('data-job-id', /.+/);
  const jobId = (await status.getAttribute('data-job-id'))!;

  expect((await ownerPage.request.get(`/api/try-on/jobs/${jobId}`)).status()).toBe(200);

  const intruder = await browser.newContext();
  const intruderPage = await intruder.newPage();
  await registerWithProfile(intruderPage, 'en', { prefix: 'p05' });
  const response = await intruderPage.request.get(`/api/try-on/jobs/${jobId}`);
  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual({ error: 'not_found' });

  const anonymous = await browser.newContext();
  expect((await anonymous.request.get(`/api/try-on/jobs/${jobId}`)).status()).toBe(401);

  await Promise.all([owner.close(), intruder.close(), anonymous.close()]);
});

test('a forged provider callback is refused', async ({ request }) => {
  const response = await request.post('/api/try-on/callback/mock', {
    data: {
      eventId: 'evt-forged',
      providerJobId: 'mock_abc_0123456789abcdef',
      status: 'completed',
      resultUrl: 'https://attacker.example/x.png',
      errorCode: null,
      occurredAt: new Date().toISOString(),
    },
  });
  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual({ received: false });
});

for (const locale of ['ar', 'en'] as const) {
  test(`the try-on panel has no axe violations, and works from the keyboard (${locale})`, async ({
    page,
  }) => {
    await registerWithProfile(page, locale, { prefix: 'p05' });
    await page.goto(ROOM(locale), { waitUntil: 'networkidle' });
    await expect(panel(page)).toBeVisible();
    await axe(page);

    const checkbox = panel(page).getByRole('checkbox');
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
    await page.keyboard.press('Tab');
    await expect(
      panel(page).getByRole('button', {
        name: locale === 'ar' ? 'جرّبها بالذكاء الاصطناعي' : 'Try on with AI',
      }),
    ).toBeFocused();
  });
}

test('the panel fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await registerWithProfile(page, 'en', { prefix: 'p05' });
  await page.goto(ROOM('en'), { waitUntil: 'networkidle' });
  await expect(panel(page)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
