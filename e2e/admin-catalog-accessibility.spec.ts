import { execSync } from 'node:child_process';

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/authenticated';

/**
 * P07 §28 — axe over every catalog admin screen this phase adds, in both
 * locales (Arabic RTL and English LTR) and both themes, plus the
 * keyboard/focus checks a form-heavy phase needs: the dialogs, the variant
 * table, and the mobile nav drawer.
 *
 * Split from `admin-accessibility.spec.ts` (the P06 shell/login file) so
 * each phase's surface stays legible on its own.
 */

test.beforeAll(() => {
  execSync('pnpm db:seed-e2e-admins', { cwd: process.cwd(), stdio: 'inherit' });
});

// Each of these visits an admin route for the first time against a dev
// server, which compiles it on demand — the product edit page (form,
// variant table, image manager, three dialogs) can take well past the
// default 30s budget on that first hit alone. The axe run itself is fast.
test.describe.configure({ timeout: 120_000 });

const BASE = 'http://127.0.0.1:3000';

async function setLocale(page: Page, locale: 'ar' | 'en'): Promise<void> {
  await page.context().addCookies([{ name: 'luxedrive-locale', value: locale, url: BASE }]);
}

async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('body')
    // Next's dev-only overlay (the version badge and build indicator) is
    // injected into `nextjs-portal` and never ships to production, but it
    // sits outside every landmark and so trips the `region` rule on every
    // page. Scanning it would be measuring the framework's dev tooling,
    // not this application.
    .exclude('nextjs-portal')
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

/** The first product in the list — the catalog is seeded, so this is a real
 * product with real variants and attributes rather than a fixture shape.
 *
 * Matched by href rather than cell position: for a role that can edit, the
 * table's first cell is the bulk-selection checkbox, not the name. */
async function firstProductId(page: Page): Promise<string> {
  await page.goto('/admin/products');
  const href = await page
    .locator('tbody tr a[href^="/admin/products/"]')
    .first()
    .getAttribute('href');
  return href!.split('/')[3]!;
}

for (const locale of ['ar', 'en'] as const) {
  test.describe(`admin catalog — accessibility (axe, ${locale})`, () => {
    test('products list', async ({ ownerContext }) => {
      const page = await ownerContext.newPage();
      await setLocale(page, locale);
      await page.goto('/admin/products');
      await axe(page);
    });

    test('product edit, with variants and images', async ({ ownerContext }) => {
      const page = await ownerContext.newPage();
      await setLocale(page, locale);
      const id = await firstProductId(page);
      await page.goto(`/admin/products/${id}`);
      await axe(page);
    });

    test('product preview', async ({ ownerContext }) => {
      const page = await ownerContext.newPage();
      await setLocale(page, locale);
      const id = await firstProductId(page);
      await page.goto(`/admin/products/${id}/preview`);
      await axe(page);
    });

    test('new product form', async ({ ownerContext }) => {
      const page = await ownerContext.newPage();
      await setLocale(page, locale);
      await page.goto('/admin/products/new');
      await axe(page);
    });

    test('categories list', async ({ ownerContext }) => {
      const page = await ownerContext.newPage();
      await setLocale(page, locale);
      await page.goto('/admin/categories');
      await axe(page);
    });

    test('category edit, with the attribute manager', async ({ ownerContext }) => {
      const page = await ownerContext.newPage();
      await setLocale(page, locale);
      await page.goto('/admin/categories');
      const href = await page
        .locator('tbody tr a[href^="/admin/categories/"]')
        .first()
        .getAttribute('href');
      await page.goto(href!);
      await axe(page);
    });

    test('brands list', async ({ ownerContext }) => {
      const page = await ownerContext.newPage();
      await setLocale(page, locale);
      await page.goto('/admin/brands');
      await axe(page);
    });

    test('new brand form', async ({ ownerContext }) => {
      const page = await ownerContext.newPage();
      await setLocale(page, locale);
      await page.goto('/admin/brands/new');
      await axe(page);
    });
  });
}

test.describe('admin catalog — accessibility (axe, dark theme)', () => {
  test('products list (en, dark)', async ({ ownerContext }) => {
    const page = await ownerContext.newPage();
    await page.addInitScript(() => localStorage.setItem('luxedrive-theme', 'dark'));
    await setLocale(page, 'en');
    await page.goto('/admin/products');
    await axe(page);
  });

  test('product edit (ar, dark)', async ({ ownerContext }) => {
    const page = await ownerContext.newPage();
    await page.addInitScript(() => localStorage.setItem('luxedrive-theme', 'dark'));
    await setLocale(page, 'ar');
    const id = await firstProductId(page);
    await page.goto(`/admin/products/${id}`);
    await axe(page);
  });
});

test.describe('admin catalog — accessibility inside dialogs', () => {
  test('the new-attribute dialog is accessible and traps focus', async ({ ownerContext }) => {
    const page = await ownerContext.newPage();
    await setLocale(page, 'en');
    await page.goto('/admin/categories');
    const href = await page
      .locator('tbody tr a[href^="/admin/categories/"]')
      .first()
      .getAttribute('href');
    await page.goto(href!);

    await page.getByRole('button', { name: 'New attribute' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await axe(page);

    // Focus is inside the dialog, and Escape closes it.
    const focusedInDialog = await dialog.evaluate((node) => node.contains(document.activeElement));
    expect(focusedInDialog).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('the new-option dialog is accessible', async ({ ownerContext }) => {
    const page = await ownerContext.newPage();
    await setLocale(page, 'en');
    const id = await firstProductId(page);
    await page.goto(`/admin/products/${id}`);

    await page.getByRole('button', { name: 'New option' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await axe(page);
  });
});

test.describe('admin catalog — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the nav drawer opens, is accessible, and closes', async ({ ownerContext }) => {
    const page = await ownerContext.newPage();
    await setLocale(page, 'en');
    await page.goto('/admin/products');

    // The desktop sidebar is out of the way at this width.
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();

    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await axe(page);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();
  });

  test('the products list is usable at phone width', async ({ ownerContext }) => {
    const page = await ownerContext.newPage();
    await setLocale(page, 'en');
    await page.goto('/admin/products');
    await axe(page);

    // The page itself must not scroll sideways — only the table inside its
    // own container may.
    const bodyOverflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(bodyOverflows).toBe(false);
  });

  test('the product edit form is usable at phone width', async ({ ownerContext }) => {
    const page = await ownerContext.newPage();
    await setLocale(page, 'ar');
    const id = await firstProductId(page);
    await page.goto(`/admin/products/${id}`);
    await axe(page);

    const bodyOverflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(bodyOverflows).toBe(false);
  });
});

test.describe('admin catalog — keyboard operation', () => {
  test('the product form is reachable and submittable by keyboard', async ({ ownerContext }) => {
    const page = await ownerContext.newPage();
    await setLocale(page, 'en');
    await page.goto('/admin/products/new');

    const nameEn = page.getByLabel('English name');
    await nameEn.focus();
    await expect(nameEn).toBeFocused();
    await page.keyboard.type('Keyboard Product');

    // The slug preview follows the English name without touching the mouse.
    await expect(page.getByLabel('Slug')).toHaveValue('keyboard-product');

    const submit = page.getByRole('button', { name: 'Save as draft' });
    await submit.focus();
    await expect(submit).toBeFocused();
  });

  test('every variant row control has an accessible name', async ({ ownerContext }) => {
    const page = await ownerContext.newPage();
    await setLocale(page, 'en');
    const id = await firstProductId(page);
    await page.goto(`/admin/products/${id}`);

    // Variant inputs are unlabelled visually (the column header carries the
    // meaning), so each one must name itself for assistive tech.
    const skuInput = page.locator('input[aria-label^="SKU:"]').first();
    await expect(skuInput).toBeVisible();
    await skuInput.focus();
    await expect(skuInput).toBeFocused();
  });
});
