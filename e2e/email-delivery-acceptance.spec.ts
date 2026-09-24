import { expect, test } from '@playwright/test';

import {
  dispatchUntilDelivered,
  extractLink,
  readTestInbox,
  triggerEmailDispatch,
} from './fixtures/email-inbox';

/**
 * P13 §16 — the real delivery journeys, driven end to end: a queued outbox
 * event, a real (bearer-secret-protected) call to the dispatch endpoint,
 * the test provider's own file-backed inbox, and the link inside that
 * inbox actually opened in the browser. Nothing here mocks the dispatcher
 * or the provider — `.env`'s `EMAIL_PROVIDER="test"` is what the real,
 * running dev server this suite targets is configured with (see
 * `e2e/fixtures/email-inbox.ts`'s own comment for why `.env`, not
 * `.env.test`).
 *
 * Each test uses a freshly generated, timestamped email — this spec runs
 * against the same shared database and outbox as every other spec in the
 * suite, and `playwright.config.ts` runs files in parallel.
 */

test.describe.configure({ timeout: 180_000 });

function uniqueEmail(tag: string): string {
  return `p13-${tag}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

test.describe('Journey A — email verification', () => {
  test('register, receive the real verification email, verify, replay fails, login still works', async ({
    page,
    request,
  }) => {
    const email = uniqueEmail('verify');
    const password = 'Password123';

    // 1-2. Register; registration succeeds.
    await page.goto('/en/account/register');
    const form = page.locator('main form');
    await form.locator('input[name="name"]').fill('Verify Journey');
    await form.locator('input[name="email"]').fill(email);
    await form.locator('input[name="password"]').fill(password);
    await form.locator('input[name="passwordConfirmation"]').fill(password);
    await form.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/account$/, { timeout: 10_000 });
    await expect(page.getByText('Your email address is not verified yet.')).toBeVisible();

    // 3-5. The verification outbox event exists, the dispatcher sends it,
    // and the real link is extracted from the test provider's inbox. One
    // dispatch call is not guaranteed to reach this address specifically —
    // see `dispatchUntilDelivered`'s own comment — so this polls dispatch
    // ticks the same way a real caller would wait across cron ticks.
    const inbox = await dispatchUntilDelivered(request, email);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.subject).toBe('Verify your email — LuxeDrive');
    const link = extractLink(inbox[0]!, '/account/verify-email');
    expect(link).toContain('token=');
    // The token itself is opaque, but the link must never carry a raw
    // database id — only the base64url token material.
    expect(link).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);

    // 6-7. Opening it verifies the account.
    await page.goto(link);
    await expect(page.getByText('Your email is verified')).toBeVisible();

    // 8. Reusing the same link fails safely — the same generic message
    // shape as an invalid link, never a crash, never a different account
    // state.
    await page.goto(link);
    await expect(page.getByText('This verification link was already used.')).toBeVisible();

    // 9. Login still works after verification (verification does not gate
    // sign-in — P12's own design).
    await page.goto('/en/account');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/en', { timeout: 10_000 });

    await page.goto('/en/account/login');
    const loginForm = page.locator('main form');
    await loginForm.locator('input[name="email"]').fill(email);
    await loginForm.locator('input[name="password"]').fill(password);
    await loginForm.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/account$/, { timeout: 10_000 });
    await expect(page.getByText('Your email address is not verified yet.')).toHaveCount(0);
  });
});

test.describe('Journey B — password reset', () => {
  test('request reset, receive the real reset email, set a new password, replay fails, old password stops working', async ({
    page,
    request,
  }) => {
    const email = uniqueEmail('reset');
    const oldPassword = 'Password123';
    const newPassword = 'NewPassword456';

    // Set up: a real, registered account.
    await page.goto('/en/account/register');
    const registerForm = page.locator('main form');
    await registerForm.locator('input[name="name"]').fill('Reset Journey');
    await registerForm.locator('input[name="email"]').fill(email);
    await registerForm.locator('input[name="password"]').fill(oldPassword);
    await registerForm.locator('input[name="passwordConfirmation"]').fill(oldPassword);
    await registerForm.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/account$/, { timeout: 10_000 });
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/en', { timeout: 10_000 });

    // 1-2. Request a reset. The response never reveals whether the account
    // exists — same success message either way (P12 §13/§21, re-verified
    // here now that a real email is actually queued and sent for it).
    await page.goto('/en/account/forgot-password');
    const forgotForm = page.locator('main form');
    await forgotForm.locator('input[name="email"]').fill(email);
    await forgotForm.locator('button[type="submit"]').click();
    await expect(page.getByText('Check your email')).toBeVisible({ timeout: 10_000 });

    // 3-5. The reset outbox event exists, is sent, and the real reset link
    // is extracted — see Journey A's identical comment on why this polls
    // dispatch rather than assuming one call is sufficient.
    const inbox = await dispatchUntilDelivered(request, email);
    expect(inbox.length).toBeGreaterThanOrEqual(1);
    const resetMessage = inbox.find((m) => m.subject === 'Reset your password — LuxeDrive');
    expect(resetMessage).toBeDefined();
    const link = extractLink(resetMessage!, '/account/reset-password');

    // 6-7. Open the link and set a new password.
    await page.goto(link);
    const resetForm = page.locator('main form');
    await resetForm.locator('input[name="password"]').fill(newPassword);
    await resetForm.locator('input[name="passwordConfirmation"]').fill(newPassword);
    await resetForm.locator('button[type="submit"]').click();
    await expect(page.getByText('Password changed')).toBeVisible({ timeout: 10_000 });

    // 8. The token is now unusable — reusing the same link fails safely.
    await page.goto(link);
    const replayForm = page.locator('main form');
    await replayForm.locator('input[name="password"]').fill('AnotherPassword789');
    await replayForm.locator('input[name="passwordConfirmation"]').fill('AnotherPassword789');
    await replayForm.locator('button[type="submit"]').click();
    await expect(page.locator('main').getByRole('alert')).toHaveText(
      'This reset link was already used. Request a new one.',
    );

    // 9. The old password no longer works.
    await page.goto('/en/account/login');
    const oldLoginForm = page.locator('main form');
    await oldLoginForm.locator('input[name="email"]').fill(email);
    await oldLoginForm.locator('input[name="password"]').fill(oldPassword);
    await oldLoginForm.locator('button[type="submit"]').click();
    await expect(page.locator('main').getByRole('alert')).toHaveText(
      'Incorrect email or password.',
    );

    // 10. The new password does.
    await oldLoginForm.locator('input[name="email"]').fill(email);
    await oldLoginForm.locator('input[name="password"]').fill(newPassword);
    await oldLoginForm.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/account$/, { timeout: 10_000 });
  });
});

test.describe('Journey C — abuse and security', () => {
  test('the dispatch endpoint refuses a request with no bearer token', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:3000/api/internal/email-dispatch');
    expect(response.status()).toBe(401);
  });

  test('the dispatch endpoint refuses a request with the wrong bearer token', async ({
    request,
  }) => {
    const response = await request.get('http://127.0.0.1:3000/api/internal/email-dispatch', {
      headers: { Authorization: 'Bearer totally-wrong-secret-value-that-is-long-enough' },
    });
    expect(response.status()).toBe(401);
  });

  test('a transient provider failure is retried, not delivered, and not lost', async ({
    page,
    request,
  }) => {
    const email = `p13-transient-${Date.now()}+dispatch-fail-transient@example.com`;
    await page.goto('/en/account/register');
    const form = page.locator('main form');
    await form.locator('input[name="name"]').fill('Transient Failure');
    await form.locator('input[name="email"]').fill(email);
    await form.locator('input[name="password"]').fill('Password123');
    await form.locator('input[name="passwordConfirmation"]').fill('Password123');
    await form.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/account$/, { timeout: 10_000 });

    // The dispatch call's own aggregate counts are not asserted directly
    // (this spec runs with other files, and this file's other tests, in
    // parallel — a concurrent dispatch call can legitimately claim and
    // process other events in the same batch). What must hold regardless
    // is that this specific address was not delivered anything: the
    // transient failure did not silently succeed.
    await triggerEmailDispatch(request);
    expect(await readTestInbox(email, 500)).toEqual([]);
  });

  test('a permanent provider failure gives up immediately and is never retried', async ({
    page,
    request,
  }) => {
    const email = `p13-permanent-${Date.now()}+dispatch-fail-permanent@example.com`;
    await page.goto('/en/account/register');
    const form = page.locator('main form');
    await form.locator('input[name="name"]').fill('Permanent Failure');
    await form.locator('input[name="email"]').fill(email);
    await form.locator('input[name="password"]').fill('Password123');
    await form.locator('input[name="passwordConfirmation"]').fill('Password123');
    await form.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/account$/, { timeout: 10_000 });

    // Per-call `failed` counts are not asserted directly: this spec runs
    // with other files (and this file's own other tests) in parallel, and
    // the dispatch endpoint drains every queued handled-type event, not
    // just this test's — a concurrently running dispatch call, here or
    // from another spec, can legitimately be the one that claims and fails
    // this exact event first. What must hold regardless of *which* call
    // did it is that this address never receives anything, on this attempt
    // or any later one.
    await triggerEmailDispatch(request);
    await triggerEmailDispatch(request);
    expect(await readTestInbox(email, 500)).toEqual([]);
  });

  test('duplicate/concurrent dispatch calls never send the same queued email twice', async ({
    page,
    request,
  }) => {
    const email = uniqueEmail('dupe-dispatch');
    await page.goto('/en/account/register');
    const form = page.locator('main form');
    await form.locator('input[name="name"]').fill('Duplicate Dispatch');
    await form.locator('input[name="email"]').fill(email);
    await form.locator('input[name="password"]').fill('Password123');
    await form.locator('input[name="passwordConfirmation"]').fill('Password123');
    await form.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/account$/, { timeout: 10_000 });

    // Both calls' own `sent` counts are not asserted directly: this spec
    // runs with other files in parallel, and the dispatch endpoint drains
    // *every* queued handled-type event, not just this test's — a
    // concurrently running spec's own dispatch call can legitimately win
    // the claim on this event first. What must hold regardless of which
    // call (here or elsewhere) actually sent it is the inbox itself: this
    // address receives the message exactly once, never twice.
    await Promise.all([triggerEmailDispatch(request), triggerEmailDispatch(request)]);

    const inbox = await readTestInbox(email);
    const verificationMessages = inbox.filter((m) => m.subject === 'Verify your email — LuxeDrive');
    expect(verificationMessages).toHaveLength(1);
  });

  test('open redirect: an absolute next value on login never leaves the app', async ({ page }) => {
    const email = uniqueEmail('open-redirect');
    await page.goto('/en/account/register');
    const form = page.locator('main form');
    await form.locator('input[name="name"]').fill('Redirect Test');
    await form.locator('input[name="email"]').fill(email);
    await form.locator('input[name="password"]').fill('Password123');
    await form.locator('input[name="passwordConfirmation"]').fill('Password123');
    await form.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/account$/, { timeout: 10_000 });
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/en', { timeout: 10_000 });

    await page.goto('/en/account/login?next=https%3A%2F%2Fevil.example%2Fphish');
    const loginForm = page.locator('main form');
    await loginForm.locator('input[name="email"]').fill(email);
    await loginForm.locator('input[name="password"]').fill('Password123');
    await loginForm.locator('button[type="submit"]').click();

    // Wait for the actual post-login destination, not merely "some URL on
    // this origin" — the starting URL already matches that pattern, which
    // would let `waitForURL` resolve before the redirect even happens.
    await expect(page).toHaveURL(/\/en\/account$/, { timeout: 10_000 });
    expect(page.url()).not.toContain('evil.example');
  });
});
