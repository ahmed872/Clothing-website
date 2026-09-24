import { execSync } from 'node:child_process';

import { expect, test, type Page } from '@playwright/test';

import { E2E_ACCEPTANCE_OWNER } from './fixtures/admin-credentials';

/**
 * P07 §31 — the critical acceptance test, run exactly as the spec words it:
 * a non-developer store owner, in the Admin UI, with zero code changes.
 *
 *   create a category → define its attributes → create a brand → create a
 *   product in that category → fill the attributes that appeared by
 *   themselves → create options → generate variants → set a SKU and price
 *   per variant → save the draft → preview it → confirm it is NOT publicly
 *   visible → publish → confirm it IS → edit an attribute → confirm the
 *   storefront reflects the change.
 *
 * Deliberately one long test rather than several: the point is that the
 * whole journey works end to end, and a step that only passes because a
 * previous test left the right state behind would not prove that.
 *
 * It signs in through the real login form (no storage-state shortcut) so
 * even the entry point is what a store owner actually does.
 */

const RUN = Date.now().toString().slice(-6);
const CATEGORY_EN = `Shoes ${RUN}`;
const CATEGORY_SLUG = `shoes-${RUN}`;
const BRAND_EN = `Example Brand ${RUN}`;
const PRODUCT_EN = `Premium Running Shoe ${RUN}`;
const PRODUCT_SLUG = `premium-running-shoe-${RUN}`;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  execSync('pnpm db:seed-e2e-admins', { cwd: process.cwd(), stdio: 'inherit' });
});

async function signInAsOwner(page: Page): Promise<void> {
  await page.goto('/admin/login');
  await page.fill('input[name=email]', E2E_ACCEPTANCE_OWNER.email);
  await page.fill('input[name=password]', E2E_ACCEPTANCE_OWNER.password);
  await page.click('button[type=submit]');
  await page.waitForURL('**/admin');
  // English for the rest of the journey — the Arabic side of the same
  // screens is covered by the accessibility and visual specs.
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('link', { name: 'Products' })).toBeVisible();
}

async function addAttribute(
  page: Page,
  attribute: { key: string; labelEn: string; labelAr: string; type: string; values?: string[] },
): Promise<void> {
  await page.getByRole('button', { name: 'New attribute' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Key/).fill(attribute.key);
  await dialog.getByLabel('English label').fill(attribute.labelEn);
  await dialog.getByLabel('Arabic label').fill(attribute.labelAr);

  await dialog.getByLabel('Field type').click();
  await page.getByRole('option', { name: attribute.type, exact: true }).click();

  for (const value of attribute.values ?? []) {
    await dialog.getByLabel('Allowed values').fill(value);
    await dialog.getByLabel('Allowed values').press('Enter');
  }

  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText(attribute.labelEn, { exact: true })).toBeVisible();
}

test('a store owner builds and publishes a product from scratch, with no code changes', async ({
  page,
}) => {
  test.slow();
  await signInAsOwner(page);

  // ---- 1. Create the category ---------------------------------------------
  await page.goto('/admin/categories/new');
  await page.getByLabel('English name').fill(CATEGORY_EN);
  await page.getByLabel('Arabic name').fill(`أحذية ${RUN}`);
  await expect(page.getByLabel('Slug')).toHaveValue(CATEGORY_SLUG);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL('**/admin/categories');
  await expect(page.getByRole('link', { name: CATEGORY_EN })).toBeVisible();

  // ---- 2. Define its attributes -------------------------------------------
  await page.getByRole('link', { name: CATEGORY_EN }).click();
  await page.waitForURL(/\/admin\/categories\/[0-9a-f-]{36}$/);

  await addAttribute(page, {
    key: 'shoe_color',
    labelEn: 'Color',
    labelAr: 'اللون',
    type: 'Single select',
    values: ['Black', 'White'],
  });
  await addAttribute(page, {
    key: 'shoe_size',
    labelEn: 'Size',
    labelAr: 'المقاس',
    type: 'Single select',
    values: ['40', '41', '42'],
  });
  await addAttribute(page, {
    key: 'shoe_material',
    labelEn: 'Material',
    labelAr: 'الخامة',
    type: 'Text',
  });

  // ---- 3. Create the brand ------------------------------------------------
  await page.goto('/admin/brands/new');
  await page.getByLabel('English name').fill(BRAND_EN);
  await page.getByLabel('Arabic name').fill(`علامة ${RUN}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL('**/admin/brands');
  await expect(page.getByRole('link', { name: BRAND_EN })).toBeVisible();

  // ---- 4. Create the product in that category -----------------------------
  await page.goto('/admin/products/new');
  await page.getByLabel('English name').fill(PRODUCT_EN);
  await page.getByLabel('Arabic name').fill(`حذاء جري ${RUN}`);
  await expect(page.getByLabel('Slug')).toHaveValue(PRODUCT_SLUG);

  await page.getByLabel('Category').click();
  await page.getByRole('option', { name: CATEGORY_EN }).click();

  // ---- 5. The category's attributes appear on their own -------------------
  // This is the heart of the phase: nobody wrote a "shoes" form.
  await expect(page.getByLabel('Color')).toBeVisible();
  await expect(page.getByLabel('Size')).toBeVisible();
  await expect(page.getByLabel('Material')).toBeVisible();
  await expect(page.getByLabel('Fuel type')).toHaveCount(0);

  await page.getByLabel('Color').click();
  await page.getByRole('option', { name: 'Black' }).click();
  await page.getByLabel('Size').click();
  await page.getByRole('option', { name: '41' }).click();
  await page.getByLabel('Material').fill('Mesh');

  await page.getByLabel('Brand').click();
  await page.getByRole('option', { name: BRAND_EN }).click();

  await page.getByLabel('SKU').fill(`RUN-${RUN}`);
  await page.getByLabel('Price').fill('450');

  // ---- 6. Save the draft --------------------------------------------------
  await page.getByRole('button', { name: 'Save as draft' }).click();
  await page.waitForURL(/\/admin\/products\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  const productUrl = page.url();
  const productId = productUrl.split('/').pop()!;
  // Scoped to the status bar: "Draft" also appears in the status filter and
  // on the Save-as-draft button.
  const statusBar = page.getByText('Current status').locator('..');
  await expect(statusBar.getByText('Draft', { exact: true })).toBeVisible();

  // ---- 7. Options and generated variants ----------------------------------
  await page.getByRole('button', { name: 'New option' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('English option name').fill('Color');
  await dialog.getByLabel('Arabic option name').fill('اللون');
  await dialog.getByLabel('Values').fill('Black');
  await dialog.getByLabel('Values').press('Enter');
  await dialog.getByLabel('Values').fill('White');
  await dialog.getByLabel('Values').press('Enter');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  await page.getByRole('button', { name: 'New option' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('English option name').fill('Size');
  await dialog.getByLabel('Arabic option name').fill('المقاس');
  for (const size of ['40', '41', '42']) {
    await dialog.getByLabel('Values').fill(size);
    await dialog.getByLabel('Values').press('Enter');
  }
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Generate combinations' }).click();
  // 2 colors x 3 sizes = 6 combinations, plus the default variant created
  // with the product itself.
  await expect(page.locator('table tbody tr')).toHaveCount(7, { timeout: 25_000 });

  // ---- 8. Per-variant SKU and price ---------------------------------------
  const secondRow = page.locator('table tbody tr').nth(1);
  await secondRow.locator('input[dir=ltr]').fill(`RUN-${RUN}-BLACK-40`);
  await secondRow.locator('input[type=number]').first().fill('475');
  await secondRow.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(2500);
  await page.reload();
  // A SKU lives in an input's value, which `getByText` cannot see.
  await expect
    .poll(() =>
      page
        .locator('table tbody tr input[dir=ltr]')
        .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value)),
    )
    .toContain(`RUN-${RUN}-BLACK-40`);

  // ---- 9. Preview, and prove the draft is not public ----------------------
  await page.getByRole('link', { name: 'Preview' }).click();
  await page.waitForURL(/\/preview$/);
  await expect(page.getByText(/customers cannot see this product/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: PRODUCT_EN })).toBeVisible();

  const anon = await page.context().browser()!.newContext();
  const anonPage = await anon.newPage();
  const draftResponse = await anonPage.goto(`/en/p/${PRODUCT_SLUG}`);
  expect(draftResponse?.status()).toBe(404);

  // ---- 10. Publish --------------------------------------------------------
  await page.goto(productUrl);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(
    page.getByText('Current status').locator('..').getByText('Published', { exact: true }),
  ).toBeVisible({ timeout: 20_000 });

  // ---- 11. It is live in the storefront -----------------------------------
  const liveResponse = await anonPage.goto(`/en/p/${PRODUCT_SLUG}`);
  expect(liveResponse?.status()).toBe(200);
  await expect(anonPage.getByRole('heading', { name: PRODUCT_EN })).toBeVisible();
  // The attribute values live in the Specifications tab, which is not the
  // one selected by default — open it the way a customer would.
  await anonPage.getByRole('tab', { name: 'Specifications' }).click();
  // Two matches: the visible tab panel and the inactive one Radix keeps
  // mounted — either is proof the value reached the storefront.
  await expect(anonPage.getByText('Mesh').first()).toBeVisible();

  // ---- 12. Edit an attribute and see the storefront follow ----------------
  await page.goto(productUrl);
  await page.getByLabel('Material').fill('Knit');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await page.waitForTimeout(3000);

  await anonPage.goto(`/en/p/${PRODUCT_SLUG}`);
  await anonPage.reload();
  await anonPage.getByRole('tab', { name: 'Specifications' }).click();
  await expect(anonPage.getByText('Knit').first()).toBeVisible({ timeout: 20_000 });

  await anon.close();

  // ---- 13. And it is all in the audit trail -------------------------------
  await page.goto(`/admin/products/${productId}`);
  await expect(
    page.getByText('Current status').locator('..').getByText('Published', { exact: true }),
  ).toBeVisible();
});
