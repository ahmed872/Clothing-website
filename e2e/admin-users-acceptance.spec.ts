import { execSync } from 'node:child_process';

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/authenticated';
import { E2E_USERS_OWNER } from './fixtures/admin-credentials';

/**
 * P14 §B/§D/§I — staff administration, driven end to end in a real browser:
 * an owner creates a staff account, the new account signs in for real, its
 * role is changed, it is disabled, and it can no longer sign in. Plus axe
 * over both screens in both locales, and the 390px layout.
 *
 * Every account this spec creates carries a unique, timestamped email: the
 * whole suite runs in parallel against one shared database, and a fixed
 * address would collide with a previous run's row (`users.email` is
 * unique) or with a sibling worker's.
 */

test.beforeAll(() => {
  execSync('pnpm db:seed-e2e-admins', { cwd: process.cwd(), stdio: 'inherit' });
});

test.describe.configure({ timeout: 180_000 });

const BASE = 'http://127.0.0.1:3000';

/** Satisfies the admin policy: 12+ characters, a letter and a number. */
const NEW_STAFF_PASSWORD = 'P14StaffPass99';

function uniqueEmail(tag: string): string {
  return `p14-${tag}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

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

async function createStaffAccount(page: Page, email: string, role: 'Staff' | 'Store Manager') {
  await page.goto('/admin/users/new');
  await expect(page.getByRole('heading', { name: 'New user' })).toBeVisible({ timeout: 60_000 });

  const form = page.locator('main form');
  await form.getByLabel('Email').fill(email);
  await form.getByLabel(/^Name/).fill('P14 Journey');
  await form.getByLabel('Password', { exact: true }).fill(NEW_STAFF_PASSWORD);

  await form.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: role }).click();

  await form.getByRole('button', { name: 'Create user' }).click();
  await page.waitForURL('**/admin/users');
  await expect(page.getByText(email)).toBeVisible();
}

test.describe('the staff administration journey', () => {
  test('create, sign in, change role, disable, and sign-in is refused', async ({
    usersOwnerContext,
  }) => {
    const page = await usersOwnerContext.newPage();
    await setLocale(page, 'en');

    const email = uniqueEmail('journey');

    // 1. The owner creates a STAFF account.
    await createStaffAccount(page, email, 'Staff');
    const row = page.locator('tbody tr').filter({ hasText: email });
    await expect(row.getByText('Staff')).toBeVisible();
    await expect(row.getByText('Active')).toBeVisible();
    await expect(row.getByText('Never signed in')).toBeVisible();

    // 2. That account is real: it signs in through the actual login form,
    // in its own browser context with no borrowed session.
    const staffContext = await page.context().browser()!.newContext();
    await staffContext.route('**/*', (route) => {
      const { hostname } = new URL(route.request().url());
      return hostname === '127.0.0.1' || hostname === 'localhost'
        ? route.continue()
        : route.abort();
    });
    const staffPage = await staffContext.newPage();
    await setLocale(staffPage, 'en');
    await staffPage.goto('/admin/login');
    await staffPage.fill('input[name=email]', email);
    await staffPage.fill('input[name=password]', NEW_STAFF_PASSWORD);
    await staffPage.click('button[type=submit]');
    await staffPage.waitForURL('**/admin');

    // 3. A brand-new STAFF account gets no Users link, and the URL is
    // refused too — the permission, not the navigation, is the control.
    await expect(staffPage.getByRole('link', { name: /^Users$/ })).toHaveCount(0);
    const forbidden = await staffPage.goto('/admin/users');
    expect(forbidden?.ok()).toBeFalsy();

    // 4. The owner promotes them to MANAGER.
    await page.reload();
    await row.getByRole('button', { name: /^Change role/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Role' }).click();
    await page.getByRole('option', { name: 'Store Manager' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row.getByText('Store Manager')).toBeVisible();

    // 5. The change is live on the promoted account's very next request —
    // no re-login, no waiting for a JWT to expire (P06's `jwt` callback
    // re-reads the user every time).
    await staffPage.goto('/admin');
    await expect(staffPage.getByRole('link', { name: /^Promotions$/ })).toBeVisible();

    // 6. The owner disables the account.
    await row.getByRole('button', { name: /^Disable/ }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row.getByText('Disabled')).toBeVisible();

    // 7. The disabled account's live session stops working immediately…
    await staffPage.goto('/admin');
    await staffPage.waitForURL('**/admin/login');

    // 8. …and it cannot sign back in, with the same generic message a
    // wrong password gets — a disabled account is never announced as one.
    await staffPage.fill('input[name=email]', email);
    await staffPage.fill('input[name=password]', NEW_STAFF_PASSWORD);
    await staffPage.click('button[type=submit]');
    await expect(staffPage.locator('main [role=alert]')).toContainText(
      'That email or password is incorrect',
    );

    await staffContext.close();
  });

  test('an owner cannot change their own role or disable themselves', async ({
    usersOwnerContext,
  }) => {
    const page = await usersOwnerContext.newPage();
    await setLocale(page, 'en');
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible({ timeout: 60_000 });

    const ownRow = page.locator('tbody tr').filter({ hasText: E2E_USERS_OWNER.email });
    await expect(ownRow.getByText('(you)')).toBeVisible();
    await expect(ownRow.getByRole('button')).toHaveCount(0);
  });

  test('a duplicate email is refused with a message that names the problem', async ({
    usersOwnerContext,
  }) => {
    const page = await usersOwnerContext.newPage();
    await setLocale(page, 'en');

    const email = uniqueEmail('dup');
    await createStaffAccount(page, email, 'Staff');

    await page.goto('/admin/users/new');
    const form = page.locator('main form');
    await form.getByLabel('Email').fill(email);
    await form.getByLabel('Password', { exact: true }).fill(NEW_STAFF_PASSWORD);
    await form.getByRole('button', { name: 'Create user' }).click();

    await expect(page.locator('main [role=alert]')).toContainText('already in use');
    await expect(page).toHaveURL(/\/admin\/users\/new$/);
  });

  test('a password below the admin policy is refused client- and server-side', async ({
    usersOwnerContext,
  }) => {
    const page = await usersOwnerContext.newPage();
    await setLocale(page, 'en');
    await page.goto('/admin/users/new');

    const form = page.locator('main form');
    const password = form.getByLabel('Password', { exact: true });
    await form.getByLabel('Email').fill(uniqueEmail('weak'));
    await password.fill('short1');
    await form.getByRole('button', { name: 'Create user' }).click();

    // The form never navigates, and the field is marked invalid — the
    // always-present policy hint is not evidence on its own.
    await expect(page).toHaveURL(/\/admin\/users\/new$/);
    await expect(password).toHaveAttribute('aria-invalid', 'true');

    // And the server refuses it independently: `createStaffUserAction`
    // re-parses with the same `passwordPolicySchema`, so a request that
    // skipped this form entirely is rejected too (proven directly in
    // `user-security-matrix.test.ts`).
  });
});

for (const locale of ['ar', 'en'] as const) {
  test.describe(`admin users — accessibility (axe, ${locale})`, () => {
    test('the users list', async ({ usersOwnerContext }) => {
      const page = await usersOwnerContext.newPage();
      await setLocale(page, locale);
      await page.goto('/admin/users');
      await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });
      await axe(page);
    });

    test('the create form', async ({ usersOwnerContext }) => {
      const page = await usersOwnerContext.newPage();
      await setLocale(page, locale);
      await page.goto('/admin/users/new');
      await expect(page.locator('main form')).toBeVisible({ timeout: 60_000 });
      await axe(page);
    });

    test('the change-role dialog', async ({ usersOwnerContext }) => {
      const page = await usersOwnerContext.newPage();
      await setLocale(page, locale);
      await page.goto('/admin/users');
      await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });

      // The signed-in owner's own row has no actions, so pick a row that
      // does. Excluded by email, not by the "(you)" marker: that marker is
      // translated ("(أنت)" in Arabic), so filtering on the English string
      // silently matched nothing in the Arabic run and left this test
      // depending on which row happened to sort first.
      const actionable = page
        .locator('tbody tr')
        .filter({ hasNot: page.getByText(E2E_USERS_OWNER.email) });
      await expect(actionable.first()).toBeVisible();
      await actionable.first().getByRole('button').first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await axe(page);
    });
  });
}

test.describe('admin users — keyboard', () => {
  test('the create form is completable without a mouse', async ({ usersOwnerContext }) => {
    const page = await usersOwnerContext.newPage();
    await setLocale(page, 'en');
    await page.goto('/admin/users/new');
    const form = page.locator('main form');
    await expect(form).toBeVisible({ timeout: 60_000 });

    const email = uniqueEmail('kbd');
    await form.getByLabel('Email').focus();
    await page.keyboard.type(email);
    await page.keyboard.press('Tab');
    await page.keyboard.type('Keyboard Person');
    await page.keyboard.press('Tab');
    await page.keyboard.type(NEW_STAFF_PASSWORD);

    // Tab past the show/hide-password toggle onto the role combobox, then
    // open and choose entirely from the keyboard — no click anywhere.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(form.getByRole('combobox', { name: 'Role' })).toBeFocused();
    await page.keyboard.press('Enter');
    // Radix moves focus onto the currently-selected option once the
    // listbox has mounted; waiting for that (rather than merely for the
    // list to be visible) is what makes the arrow key land where this test
    // says it does.
    await expect(page.getByRole('option', { name: 'Staff' })).toBeFocused();
    // Options are ordered Owner, Store Manager, Staff, and the default
    // selection is Staff — one step up lands on Store Manager.
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('option', { name: 'Store Manager' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(form.getByRole('combobox', { name: 'Role' })).toContainText('Store Manager');

    await page.keyboard.press('Tab');
    await expect(form.getByRole('button', { name: 'Create user' })).toBeFocused();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/admin/users');
    await expect(page.getByText(email)).toBeVisible();
  });
});

test.describe('admin users — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the users screen is usable at 390px, with no horizontal page scroll', async ({
    usersOwnerContext,
  }) => {
    const page = await usersOwnerContext.newPage();
    await setLocale(page, 'en');
    await page.goto('/admin/users');
    await expect(page.locator('main')).toBeVisible({ timeout: 60_000 });

    // The table scrolls inside its own container; the page itself must not.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole('button', { name: /navigation/i })).toBeVisible();
  });
});
