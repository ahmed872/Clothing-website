import { execSync } from 'node:child_process';

import type { Page } from '@playwright/test';

import { expect, test } from '@playwright/test';

import { E2E_ACCOUNT_FIXTURE } from './fixtures/account-fixture';

/**
 * P12 §29 — the critical customer-identity journey, driven through the real
 * UI end to end: register, see the unverified-email notice, update a
 * profile, carry a guest cart across sign-in (the merge, P09's `max`
 * semantics untouched), check out as a known customer with pre-filled
 * contact details, find the order in account history, sign out, and sign
 * back in. Every step exercises the actual server boundary (a real cookie,
 * a real session, a real database row) rather than a mock standing in for
 * any of them.
 *
 * Each test uses a freshly generated, timestamped email — this spec runs
 * against the same shared database as every other spec in the suite, and
 * `playwright.config.ts` runs files in parallel, so nothing here may assume
 * it has the customer or product tables to itself. The merge journey buys
 * from its own always-restocked fixture products (see `fixtures/
 * account-fixture.ts`, the same pattern `orders-accessibility.spec.ts` uses)
 * rather than the demo catalog, whose single-unit stock a repeated run of
 * this file — or any neighbouring spec placing real orders — would drain.
 */

test.describe.configure({ timeout: 180_000 });

test.beforeAll(() => {
  execSync('pnpm db:seed-e2e-account', { cwd: process.cwd(), stdio: 'inherit' });
});

function uniqueEmail(tag: string): string {
  return `p12-${tag}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function addToCartFromPdp(
  page: Page,
  locale: 'ar' | 'en',
  slug: string,
  addToCartLabel: string,
): Promise<string> {
  await page.goto(`/${locale}/p/${slug}`, { waitUntil: 'networkidle' });
  const heading = await page.locator('h1').first().textContent();
  await page.getByRole('button', { name: addToCartLabel }).first().click();
  await page.waitForTimeout(500);
  return heading?.trim() ?? '';
}

test('the critical customer journey: register, profile, guest-cart merge, checkout, order history, sign out/in', async ({
  page,
}) => {
  const email = uniqueEmail('journey');
  const password = 'Password123';

  // 1. As a guest, start a cart before ever creating an account.
  const productAName = await addToCartFromPdp(
    page,
    'ar',
    E2E_ACCOUNT_FIXTURE.productA.slug,
    'أضف إلى السلة',
  );

  await page.goto('/ar/cart', { waitUntil: 'networkidle' });
  await expect(page.getByText(productAName, { exact: false }).first()).toBeVisible();

  // 2. Unauthenticated access to a protected account page redirects to login.
  await page.goto('/ar/account');
  await expect(page).toHaveURL(/\/account\/login/);

  // 3. Register. No role field exists anywhere on this form (P12 §3/§4).
  await page.goto('/ar/account/register');
  const registerForm = page.locator('main form');
  await registerForm.locator('input[name="name"]').fill('رحلة العميل');
  await registerForm.locator('input[name="email"]').fill(email);
  await registerForm.locator('input[name="phone"]').fill('0501234567');
  await registerForm.locator('input[name="password"]').fill(password);
  await registerForm.locator('input[name="passwordConfirmation"]').fill(password);
  await registerForm.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/account$/, { timeout: 10_000 });

  // 4. The overview greets the customer by name and flags the unverified
  // email — no fake "email sent" claim, no verification gate on browsing.
  const overviewBody = await page.textContent('body');
  expect(overviewBody).toMatch(/رحلة العميل|مرحبًا/);
  expect(overviewBody).toMatch(/غير مؤكَّد/);

  // 5. Update the profile. The email field is present but read-only.
  //
  // The success toast — not the input's own value — is what says the save
  // finished (P14). `ProfileForm` only raises it once the server action has
  // actually resolved successfully, whereas the input already holds the
  // typed text the instant `fill()` returns, so asserting on that proved
  // nothing and could not fail. It also left this test racing its own
  // request: the very next step navigates away, which cancels an in-flight
  // Server Action, and on a slower run the update simply never landed —
  // silently, because the assertion above it had already passed. Step 7's
  // pre-fill check was then the thing that failed, several steps from the
  // cause.
  await page.goto('/ar/account/profile');
  const profileForm = page.locator('main form');
  await expect(page.locator('input[type="email"]')).toBeDisabled();
  await profileForm.locator('input[name="name"]').fill('عميل محقق');
  await profileForm.locator('input[name="phone"]').fill('0559876543');
  await profileForm.locator('button[type="submit"]').click();
  // `exact` matters: the toast renders its title twice — the visible one,
  // and Radix's screen-reader announcement ("Notification …"), which a
  // substring match also picks up.
  await expect(page.getByText('تم تحديث ملفك الشخصي', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(profileForm.locator('input[name="name"]')).toHaveValue('عميل محقق');

  // And it is really persisted, not merely echoed back into the form.
  await page.reload();
  await expect(page.locator('main form input[name="name"]')).toHaveValue('عميل محقق');
  await expect(page.locator('main form input[name="phone"]')).toHaveValue('0559876543');

  // 6. The guest cart cookie is still in this browser context. Adding a
  // *different* product while signed in triggers the merge on the first
  // authenticated cart write (P09 §19, preserved as-is by P12) — both
  // products must now be in the one, customer-owned cart.
  const productBName = await addToCartFromPdp(
    page,
    'ar',
    E2E_ACCOUNT_FIXTURE.productB.slug,
    'أضف إلى السلة',
  );
  await page.goto('/ar/cart', { waitUntil: 'networkidle' });
  await expect(page.getByText(productAName, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(productBName, { exact: false }).first()).toBeVisible();

  // 7. Checkout pre-fills the signed-in customer's own contact details, and
  // every field stays editable and submittable.
  await page.goto('/ar/checkout', { waitUntil: 'networkidle' });
  await expect(page.locator('#email')).toHaveValue(email);
  await expect(page.locator('#fullName')).toHaveValue('عميل محقق');
  await page.getByLabel('المدينة', { exact: false }).fill('الرياض');
  await page.getByLabel('الحي', { exact: false }).fill('العليا');
  await page.getByLabel('الشارع', { exact: false }).fill('طريق الملك فهد');
  await page.getByLabel('رقم المبنى', { exact: false }).fill('3210');
  await page.getByRole('button', { name: 'تأكيد الطلب' }).click();
  await page.waitForURL(/\/order\/LD-[0-9A-Z-]+\/success/, { timeout: 60_000 });
  const orderNumber = new URL(page.url()).pathname.split('/').at(-2)!;

  // 8. The order shows up in the customer's own paginated history, and its
  // detail page is reachable the same way a guest's would be — both go
  // through the one `resolveOrderAccess` authority.
  await page.goto('/ar/account/orders');
  await expect(page.getByText(orderNumber)).toBeVisible();
  await page.goto(`/ar/account/orders/${orderNumber}`);
  await expect(page.locator('main')).toContainText(orderNumber);

  // 9. Sign out, and the protected surface is gone again. The order-detail
  // page from step 8 sits outside `(protected)` on purpose (P10's guest
  // access must keep working there), so it carries no sign-out control —
  // go back to a page inside the account shell first.
  await page.goto('/ar/account');
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await page.waitForURL('**/ar', { timeout: 10_000 });
  await page.goto('/ar/account/orders');
  await expect(page).toHaveURL(/\/account\/login/);

  // 10. Sign back in with the same credentials and reach the same history.
  const loginForm = page.locator('main form');
  await loginForm.locator('input[name="email"]').fill(email);
  await loginForm.locator('input[name="password"]').fill(password);
  await loginForm.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/account$/, { timeout: 10_000 });
  await page.goto('/ar/account/orders');
  await expect(page.getByText(orderNumber)).toBeVisible();
});

test('wrong password is rejected without revealing which part was wrong, and does not sign in', async ({
  page,
}) => {
  const email = uniqueEmail('wrongpw');
  const password = 'Password123';

  await page.goto('/en/account/register');
  const registerForm = page.locator('main form');
  await registerForm.locator('input[name="name"]').fill('Wrong Password Test');
  await registerForm.locator('input[name="email"]').fill(email);
  await registerForm.locator('input[name="password"]').fill(password);
  await registerForm.locator('input[name="passwordConfirmation"]').fill(password);
  await registerForm.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/account$/, { timeout: 10_000 });

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/en', { timeout: 10_000 });

  await page.goto('/en/account/login');
  const loginForm = page.locator('main form');
  await loginForm.locator('input[name="email"]').fill(email);
  await loginForm.locator('input[name="password"]').fill('CompletelyWrong9');
  await loginForm.locator('button[type="submit"]').click();

  await expect(page.locator('main').getByRole('alert')).toHaveText('Incorrect email or password.');
  await expect(page).toHaveURL(/\/account\/login/);
});

test('registering with an email already in use is rejected, and does not create a second account', async ({
  page,
}) => {
  const email = uniqueEmail('dupe');
  const password = 'Password123';

  await page.goto('/en/account/register');
  let form = page.locator('main form');
  await form.locator('input[name="name"]').fill('First Owner');
  await form.locator('input[name="email"]').fill(email);
  await form.locator('input[name="password"]').fill(password);
  await form.locator('input[name="passwordConfirmation"]').fill(password);
  await form.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/account$/, { timeout: 10_000 });

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/en', { timeout: 10_000 });

  await page.goto('/en/account/register');
  form = page.locator('main form');
  await form.locator('input[name="name"]').fill('Second Attempt');
  await form.locator('input[name="email"]').fill(email);
  await form.locator('input[name="password"]').fill('AnotherPassword9');
  await form.locator('input[name="passwordConfirmation"]').fill('AnotherPassword9');
  await form.locator('button[type="submit"]').click();

  await expect(page.locator('main').getByRole('alert')).toHaveText(
    'That email is already registered. Try signing in instead.',
  );
  await expect(page).toHaveURL(/\/account\/register/);
});

test('mismatched passwords are rejected before any account is created', async ({ page }) => {
  const email = uniqueEmail('mismatch');
  await page.goto('/en/account/register');
  const form = page.locator('main form');
  await form.locator('input[name="name"]').fill('Mismatch Test');
  await form.locator('input[name="email"]').fill(email);
  await form.locator('input[name="password"]').fill('Password123');
  await form.locator('input[name="passwordConfirmation"]').fill('DifferentPassword9');
  await form.locator('button[type="submit"]').click();

  await expect(page.locator('main').getByRole('alert')).toHaveText('Passwords do not match.');
  await expect(page).toHaveURL(/\/account\/register/);
});

test('forgot-password gives the same response whether or not the email exists (no enumeration)', async ({
  page,
}) => {
  const registeredEmail = uniqueEmail('resetflow');
  await page.goto('/en/account/register');
  const form = page.locator('main form');
  await form.locator('input[name="name"]').fill('Reset Flow');
  await form.locator('input[name="email"]').fill(registeredEmail);
  await form.locator('input[name="password"]').fill('Password123');
  await form.locator('input[name="passwordConfirmation"]').fill('Password123');
  await form.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/account$/, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/en', { timeout: 10_000 });

  await page.goto('/en/account/forgot-password');
  const knownForm = page.locator('main form');
  await knownForm.locator('input[name="email"]').fill(registeredEmail);
  await knownForm.locator('button[type="submit"]').click();
  await expect(page.getByText('Check your email')).toBeVisible({ timeout: 10_000 });

  await page.goto('/en/account/forgot-password');
  const unknownForm = page.locator('main form');
  await unknownForm.locator('input[name="email"]').fill(uniqueEmail('never-registered'));
  await unknownForm.locator('button[type="submit"]').click();
  await expect(page.getByText('Check your email')).toBeVisible({ timeout: 10_000 });
});

test('reset-password rejects a forged token via the real server action, without touching any account', async ({
  page,
}) => {
  await page.goto('/en/account/reset-password?token=totally-forged-token-value');
  const form = page.locator('main form');
  await expect(form).toBeVisible();
  await form.locator('input[name="password"]').fill('NewPassword123');
  await form.locator('input[name="passwordConfirmation"]').fill('NewPassword123');
  await form.locator('button[type="submit"]').click();
  await expect(page.locator('main').getByRole('alert')).toHaveText('This reset link is not valid.');
});

test('verify-email rejects a forged token via the real server action', async ({ page }) => {
  await page.goto('/en/account/verify-email?token=totally-forged-token-value');
  await expect(page.getByText('This verification link is not valid.')).toBeVisible();
});

test('verify-email with no token at all shows the same invalid state, not a crash', async ({
  page,
}) => {
  await page.goto('/en/account/verify-email');
  await expect(page.getByText('This verification link is not valid.')).toBeVisible();
});

test('the admin sign-in surface is unaffected by the storefront customer auth instance', async ({
  page,
}) => {
  await page.goto('/admin/login');
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.locator('form')).toBeVisible();
  const body = (await page.textContent('body'))?.toLowerCase() ?? '';
  expect(body).not.toContain('customer-auth');
  expect(body).not.toContain('nextauth');
});
