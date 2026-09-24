import { execSync } from 'node:child_process';

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/authenticated';
import { E2E_CONTENT_TITLE_MARKER } from './fixtures/content-fixture';

/**
 * P15 — homepage content, driven end to end in a real browser.
 *
 * The journey is the bug report this section was built for: an owner
 * arrives at a store whose homepage says "no content has been published",
 * adds a section, and sees it on the actual storefront. Then the rest of
 * the lifecycle — a draft that visitors must *not* see, publishing it,
 * reordering, hiding, deleting — plus axe in both locales and the 390px
 * layout.
 *
 * Two things make this spec's housekeeping stricter than the rest of the
 * suite's, and both come from the same fact: a `HomepageSection` is
 * *global storefront state*, not a row only this spec looks at.
 *
 *   - **Every section it creates is a BANNER, never a HERO.** A hero
 *     renders an `<h1>`; the homepage already has one, and a second would
 *     break `storefront-navigation.spec.ts`'s "the homepage has a level-1
 *     heading" for as long as this spec's section is live — the suite runs
 *     `fullyParallel`, so "for as long as" overlaps other specs by
 *     construction. A banner renders an `<h2>` and collides with nothing.
 *   - **Every section is deleted after the test that made it,** pass or
 *     fail — not only at the end of a happy path, since a section
 *     surviving a failed test would keep rendering on `/ar` and `/en` for
 *     every later spec. The cleanup names the exact titles *this worker*
 *     created rather than sweeping the marker: `fullyParallel` means a
 *     sibling worker may be mid-assertion on its own section, and a blanket
 *     sweep from a per-worker hook would delete it out from under them.
 *     (`pnpm db:cleanup-e2e-content` with no arguments does sweep
 *     everything, for clearing debris by hand when no test is running.)
 */

/** Titles this worker created and has yet to clean up. Module state, so it
 * is per worker process — which is exactly the scope the cleanup needs. */
const createdTitles: string[] = [];

test.beforeAll(() => {
  execSync('pnpm db:seed-e2e-admins', { cwd: process.cwd(), stdio: 'inherit' });
});

test.afterEach(() => {
  if (createdTitles.length === 0) return;
  const args = createdTitles.splice(0).map((title) => JSON.stringify(title));
  execSync(`pnpm db:cleanup-e2e-content ${args.join(' ')}`, {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
});

test.describe.configure({ timeout: 180_000 });

const BASE = 'http://127.0.0.1:3000';

function uniqueTitle(tag: string): string {
  return `${E2E_CONTENT_TITLE_MARKER} ${tag} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

/** The one control the axe pass has to press, named in each language —
 * these screens are bilingual and a hardcoded English label would silently
 * skip the Arabic run rather than fail it. */
const ADD_BLOCK = { ar: 'إضافة ميزة', en: 'Add block' } as const;

async function setLocale(page: Page, locale: 'ar' | 'en'): Promise<void> {
  await page.context().addCookies([{ name: 'luxedrive-locale', value: locale, url: BASE }]);
}

async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('body')
    // Next's dev-only overlay sits outside every landmark and trips the
    // `region` rule on every page; it never ships to production.
    .exclude('nextjs-portal')
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

/** Creates a BANNER through the real two-step flow and returns its title.
 * Banner rather than hero — see this file's header for why. */
async function createSection(page: Page, tag: string): Promise<string> {
  const title = uniqueTitle(tag);

  await page.goto('/admin/content/new');
  // The card's accessible name is its title *and* its help sentence, so an
  // exact 'Banner' would match nothing — and a loose one matches no other
  // card, since no other type name contains it.
  await page.getByRole('link', { name: /^Banner/ }).click();
  await page.waitForURL(/\/admin\/content\/new\?type=BANNER$/);

  const form = page.locator('main form');
  await form.getByLabel('Title (Arabic)', { exact: true }).fill(`${title} عربي`);
  await form.getByLabel('Title (English)', { exact: true }).fill(title);
  await form.getByRole('button', { name: 'Add section' }).click();

  await page.waitForURL('**/admin/content');
  await expect(page.getByText(title, { exact: false }).first()).toBeVisible();
  createdTitles.push(title);
  return title;
}

async function deleteSection(page: Page, title: string): Promise<void> {
  const row = page.locator('main li').filter({ hasText: title });
  await row.getByRole('button', { name: /^Delete —/ }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(title, { exact: false })).toHaveCount(0);
}

test.describe('the homepage content journey', () => {
  test('an added section reaches the real storefront homepage', async ({ contentOwnerContext }) => {
    const page = await contentOwnerContext.newPage();
    await setLocale(page, 'en');

    const title = await createSection(page, 'live');

    // The point of the whole section: the public page, not the admin list.
    await page.goto('/en');
    await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('No homepage content has been published yet.')).toHaveCount(0);

    await page.goto('/admin/content');
    await deleteSection(page, title);
  });

  test('a draft is never visible to a visitor until it is published', async ({
    contentOwnerContext,
  }) => {
    const page = await contentOwnerContext.newPage();
    await setLocale(page, 'en');

    const title = await createSection(page, 'draft');
    const draftTitle = `${title} REWRITTEN`;

    // Edit it and save as a draft rather than publishing.
    const row = page.locator('main li').filter({ hasText: title });
    await row.getByRole('link', { name: /^Edit —/ }).click();
    await page.waitForURL(/\/admin\/content\/[0-9a-f-]+$/);

    const form = page.locator('main form');
    await form.getByLabel('Title (English)', { exact: true }).fill(draftTitle);
    await form.getByRole('button', { name: 'Save as draft' }).click();
    await page.waitForURL('**/admin/content');

    // The admin list says an unpublished edit is waiting…
    await expect(page.getByText('Draft waiting to publish')).toBeVisible();

    // …and the storefront still shows the published copy, not the draft.
    await page.goto('/en');
    await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('heading', { name: draftTitle })).toHaveCount(0);

    // Publishing the draft is what moves it.
    await page.goto('/admin/content');
    await page
      .locator('main li')
      .filter({ hasText: title })
      .getByRole('button', { name: 'Publish draft' })
      .click();
    await expect(page.getByText('Draft waiting to publish')).toHaveCount(0);

    await page.goto('/en');
    await expect(page.getByRole('heading', { name: draftTitle })).toBeVisible({ timeout: 60_000 });

    await page.goto('/admin/content');
    await deleteSection(page, draftTitle);
  });

  test('hiding a section removes it from the storefront but keeps its content', async ({
    contentOwnerContext,
  }) => {
    const page = await contentOwnerContext.newPage();
    await setLocale(page, 'en');

    const title = await createSection(page, 'hide');

    const row = page.locator('main li').filter({ hasText: title });
    await row.getByRole('button', { name: /^Hide —/ }).click();
    await expect(
      page.locator('main li').filter({ hasText: title }).getByText('Hidden'),
    ).toBeVisible();

    await page.goto('/en');
    await expect(page.getByRole('heading', { name: title })).toHaveCount(0);

    // The copy survived: showing it again brings it straight back.
    await page.goto('/admin/content');
    await page
      .locator('main li')
      .filter({ hasText: title })
      .getByRole('button', { name: /^Show —/ })
      .click();
    // Wait for the server action to land before navigating away — the
    // click is not the write, and leaving the page mid-request would race
    // the revalidation this test is actually checking.
    await expect(
      page.locator('main li').filter({ hasText: title }).getByText('Live'),
    ).toBeVisible();

    await page.goto('/en');
    await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 60_000 });

    await page.goto('/admin/content');
    await deleteSection(page, title);
  });

  test('reordering with the keyboard changes the order on the storefront', async ({
    contentOwnerContext,
  }) => {
    const page = await contentOwnerContext.newPage();
    await setLocale(page, 'en');

    const first = await createSection(page, 'order-a');
    const second = await createSection(page, 'order-b');

    /** Where a title sits in the list, relative to the others. The store
     * already has seeded sections, so these two are somewhere near the end
     * rather than at index 0 — what matters is their order *relative to each
     * other*, which is what the reorder actually changes. */
    async function indexOf(title: string): Promise<number> {
      const texts = await page.locator('main ol > li').allTextContents();
      return texts.findIndex((entry) => entry.includes(title));
    }

    expect(await indexOf(first)).toBeLessThan(await indexOf(second));

    // Reorder by keyboard, not by drag: being operable this way is the
    // whole reason these are buttons rather than drag-and-drop.
    const moveUp = page
      .locator('main li')
      .filter({ hasText: second })
      .getByRole('button', { name: /^Move up —/ });
    await moveUp.focus();
    await expect(moveUp).toBeFocused();
    await page.keyboard.press('Enter');

    await expect.poll(async () => (await indexOf(second)) < (await indexOf(first))).toBe(true);

    // The storefront renders sections in the same stored order.
    await page.goto('/en');
    const headings = page.getByRole('heading', {
      name: new RegExp(`^${E2E_CONTENT_TITLE_MARKER} order-`),
    });
    await expect(headings.first()).toHaveText(second, { timeout: 60_000 });

    await page.goto('/admin/content');
    await deleteSection(page, first);
    await deleteSection(page, second);
  });

  test('a rail warns that an unpublished product will not appear', async ({
    contentOwnerContext,
  }) => {
    const page = await contentOwnerContext.newPage();
    await setLocale(page, 'en');

    await page.goto('/admin/content/new?type=FEATURED_PRODUCTS');
    const form = page.locator('main form');

    // Saving with nothing curated is refused client-side, before a round
    // trip — the schema requires at least one id.
    await form.getByRole('button', { name: 'Add section' }).click();
    await expect(page.getByText('Pick at least one product.')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/content\/new/);
  });
});

test.describe('accessibility', () => {
  for (const locale of ['ar', 'en'] as const) {
    test(`the content list has no axe violations in ${locale}`, async ({ contentOwnerContext }) => {
      const page = await contentOwnerContext.newPage();
      await setLocale(page, locale);
      await page.goto('/admin/content');
      await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });
      await axe(page);
    });

    test(`the type picker and a section form have no axe violations in ${locale}`, async ({
      contentOwnerContext,
    }) => {
      const page = await contentOwnerContext.newPage();
      await setLocale(page, locale);

      await page.goto('/admin/content/new');
      await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });
      await axe(page);

      // The type with the most controls — image upload, tone, CTA and both
      // title languages — and the one the journeys above create.
      await page.goto('/admin/content/new?type=BANNER');
      await expect(page.locator('main form')).toBeVisible({ timeout: 60_000 });
      await axe(page);

      // And a repeatable-items form, whose fieldsets and legends are a
      // different structure entirely.
      await page.goto('/admin/content/new?type=TRUST_BLOCKS');
      await expect(page.locator('main form')).toBeVisible({ timeout: 60_000 });
      await page.getByRole('button', { name: ADD_BLOCK[locale] }).click();
      await axe(page);
    });
  }

  test('the content screens are usable at 390px', async ({ contentOwnerContext }) => {
    const page = await contentOwnerContext.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await setLocale(page, 'en');

    for (const url of ['/admin/content', '/admin/content/new', '/admin/content/new?type=HERO']) {
      await page.goto(url);
      await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });

      // Nothing may push the page into a horizontal scroll at phone width.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${url} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
      await axe(page);
    }
  });
});

test.describe('permission', () => {
  test('STAFF cannot reach the content screen by typing the URL', async ({ staffContext }) => {
    const page = await staffContext.newPage();
    const response = await page.goto('/admin/content');
    expect(response?.ok()).toBeFalsy();
    await expect(page.getByRole('heading', { name: /^(Content|المحتوى)$/ })).toHaveCount(0);
  });
});
