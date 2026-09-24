import { execSync } from 'node:child_process';

import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/authenticated';

/**
 * Renaming the store, end to end — the bug this spec exists for.
 *
 * An owner renamed their store in Settings and the name changed *nowhere*:
 * the admin panel kept its own hardcoded wordmark, and the storefront kept
 * serving the old name out of a cache nothing invalidated. Both were real,
 * and neither was visible to any test, because every test that touched the
 * admin shell only ever asserted on navigation and every storefront test
 * asserted on products.
 *
 * So this asserts the thing the owner actually asked for: type a new name,
 * see it in both places.
 *
 * The store name is global state, so the original is always restored —
 * in a `finally`, because a test that fails halfway would otherwise leave
 * every later spec looking at a store called "E2E Renamed Store".
 */

test.beforeAll(() => {
  execSync('pnpm db:seed-e2e-admins', { cwd: process.cwd(), stdio: 'inherit' });
});

test.describe.configure({ timeout: 180_000 });

const BASE = 'http://127.0.0.1:3000';

async function setLocale(page: Page, locale: 'ar' | 'en'): Promise<void> {
  await page.context().addCookies([{ name: 'luxedrive-locale', value: locale, url: BASE }]);
}

async function saveStoreNames(page: Page, nameEn: string, nameAr: string): Promise<void> {
  await page.goto('/admin/settings');
  const form = page.locator('main form');
  await expect(form).toBeVisible({ timeout: 60_000 });

  await form.getByLabel('Store name (English)').fill(nameEn);
  await form.getByLabel('Store name (Arabic)').fill(nameAr);
  await form.getByRole('button', { name: 'Save' }).click();

  // `.first()`: the toast renders the text twice — once visibly, once in a
  // screen-reader live region — and both are legitimately "Settings saved".
  await expect(page.getByText('Settings saved').first()).toBeVisible({ timeout: 30_000 });
}

/** Whatever the store is called right now, so the test can put it back. */
async function readStoreNames(page: Page): Promise<{ en: string; ar: string }> {
  await page.goto('/admin/settings');
  const form = page.locator('main form');
  await expect(form).toBeVisible({ timeout: 60_000 });
  return {
    en: await form.getByLabel('Store name (English)').inputValue(),
    ar: await form.getByLabel('Store name (Arabic)').inputValue(),
  };
}

test.describe('renaming the store', () => {
  test('the new name reaches the admin panel and the storefront', async ({
    settingsOwnerContext,
  }) => {
    const page = await settingsOwnerContext.newPage();
    await setLocale(page, 'en');

    const original = await readStoreNames(page);
    const renamedEn = `E2E Renamed ${Date.now()}`;
    const renamedAr = `متجر ${Date.now()}`;

    try {
      await saveStoreNames(page, renamedEn, renamedAr);

      // 1. The admin shell. This is the half that was hardcoded: the
      //    sidebar and the mobile drawer both said "LuxeDrive" no matter
      //    what the store was called.
      await page.goto('/admin/settings');
      // The wordmark sits in the sidebar's `<aside>`, above and outside its
      // `<nav>` — see `components/admin/sidebar.tsx`.
      await expect(page.locator('aside').getByText(renamedEn).first()).toBeVisible({
        timeout: 30_000,
      });

      // 2. The storefront. This is the half that was cached: the header
      //    reads `getCachedStoreSettings`, whose tag no admin action
      //    invalidated, so the old name survived the save.
      await page.goto('/en');
      await expect(page.getByRole('banner').getByText(renamedEn).first()).toBeVisible({
        timeout: 30_000,
      });

      // 3. And in Arabic, from the Arabic column — not a fallback to the
      //    English one.
      await setLocale(page, 'ar');
      await page.goto('/ar');
      await expect(page.getByRole('banner').getByText(renamedAr).first()).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await setLocale(page, 'en');
      await saveStoreNames(page, original.en, original.ar);
    }
  });
});
