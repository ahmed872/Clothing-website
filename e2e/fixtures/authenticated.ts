import { test as base } from '@playwright/test';
import type { Browser, BrowserContext } from '@playwright/test';

import {
  E2E_ANALYTICS_OWNER,
  E2E_CONTENT_OWNER,
  E2E_MANAGER,
  E2E_OWNER,
  E2E_SETTINGS_OWNER,
  E2E_STAFF,
  E2E_USERS_OWNER,
} from './admin-credentials';

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

/**
 * A real login, performed once (cached per worker) and reused as storage
 * state — Playwright's documented pattern for "reuse signed-in state." Every
 * admin-auth-flow test still submits the real login form for real (that's
 * the point of those tests); this is only for tests that need to already
 * *be* signed in to check something else (axe, keyboard nav, permission
 * gating) — logging in fresh via the UI for each of those would multiply
 * real `authorize()` calls against the real login rate limiter (P06's own
 * defense working exactly as intended), which is real security, not a test
 * bug, but would make an unrelated axe check spuriously trip the rate limit
 * it isn't testing.
 */
/**
 * Chromium makes its own requests to Google endpoints (variations, autofill,
 * component updates) that no test needs. Behind an egress proxy that holds
 * such connections open rather than refusing them, they never settle, the
 * page's `load` event never fires, and every navigation stalls until the
 * test times out — a browser problem that reads exactly like a slow
 * application. Nothing under test is off-origin, so anything that isn't the
 * app under test is refused outright.
 */
async function blockOffOriginRequests(context: BrowserContext): Promise<void> {
  await context.route('**/*', (route) => {
    const { hostname } = new URL(route.request().url());
    if (hostname === '127.0.0.1' || hostname === 'localhost') return route.continue();
    return route.abort();
  });
}

async function loginAndCaptureState(
  browser: Browser,
  creds: { email: string; password: string },
): Promise<StorageState> {
  const context = await browser.newContext();
  await blockOffOriginRequests(context);
  const page = await context.newPage();
  await page.goto('/admin/login');
  await page.fill('input[name=email]', creds.email);
  await page.fill('input[name=password]', creds.password);
  await page.click('button[type=submit]');
  await page.waitForURL('**/admin');
  const state = await context.storageState();
  await context.close();
  return state;
}

let ownerStatePromise: Promise<StorageState> | undefined;
let staffStatePromise: Promise<StorageState> | undefined;
let managerStatePromise: Promise<StorageState> | undefined;
let usersOwnerStatePromise: Promise<StorageState> | undefined;
let contentOwnerStatePromise: Promise<StorageState> | undefined;
let analyticsOwnerStatePromise: Promise<StorageState> | undefined;
let settingsOwnerStatePromise: Promise<StorageState> | undefined;

// Playwright's fixture callback is conventionally named `use`, which is
// also React's hook name — ESLint's `react-hooks` rule (applied globally by
// `eslint-config-next`) can't tell these apart, so it's renamed here to
// `provide` purely to avoid a false-positive lint error; it's the exact
// same Playwright fixture-provider callback either way.
export const test = base.extend<{
  ownerContext: BrowserContext;
  staffContext: BrowserContext;
  managerContext: BrowserContext;
  usersOwnerContext: BrowserContext;
  contentOwnerContext: BrowserContext;
  analyticsOwnerContext: BrowserContext;
  settingsOwnerContext: BrowserContext;
}>({
  ownerContext: async ({ browser }, provide) => {
    ownerStatePromise ??= loginAndCaptureState(browser, E2E_OWNER);
    const context = await browser.newContext({ storageState: await ownerStatePromise });
    await blockOffOriginRequests(context);
    await provide(context);
    await context.close();
  },
  staffContext: async ({ browser }, provide) => {
    staffStatePromise ??= loginAndCaptureState(browser, E2E_STAFF);
    const context = await browser.newContext({ storageState: await staffStatePromise });
    await blockOffOriginRequests(context);
    await provide(context);
    await context.close();
  },
  managerContext: async ({ browser }, provide) => {
    managerStatePromise ??= loginAndCaptureState(browser, E2E_MANAGER);
    const context = await browser.newContext({ storageState: await managerStatePromise });
    await blockOffOriginRequests(context);
    await provide(context);
    await context.close();
  },
  /** Staff administration's own owner — see `E2E_USERS_OWNER`'s comment for
   * why it is not `ownerContext`. */
  usersOwnerContext: async ({ browser }, provide) => {
    usersOwnerStatePromise ??= loginAndCaptureState(browser, E2E_USERS_OWNER);
    const context = await browser.newContext({ storageState: await usersOwnerStatePromise });
    await blockOffOriginRequests(context);
    await provide(context);
    await context.close();
  },
  /** Homepage content's own owner (P15) — same rate-limit reasoning. */
  contentOwnerContext: async ({ browser }, provide) => {
    contentOwnerStatePromise ??= loginAndCaptureState(browser, E2E_CONTENT_OWNER);
    const context = await browser.newContext({ storageState: await contentOwnerStatePromise });
    await blockOffOriginRequests(context);
    await provide(context);
    await context.close();
  },
  /** Reporting's own owner (P15) — same rate-limit reasoning. */
  analyticsOwnerContext: async ({ browser }, provide) => {
    analyticsOwnerStatePromise ??= loginAndCaptureState(browser, E2E_ANALYTICS_OWNER);
    const context = await browser.newContext({ storageState: await analyticsOwnerStatePromise });
    await blockOffOriginRequests(context);
    await provide(context);
    await context.close();
  },
  /** Store settings' own owner (P15) — same rate-limit reasoning. */
  settingsOwnerContext: async ({ browser }, provide) => {
    settingsOwnerStatePromise ??= loginAndCaptureState(browser, E2E_SETTINGS_OWNER);
    const context = await browser.newContext({ storageState: await settingsOwnerStatePromise });
    await blockOffOriginRequests(context);
    await provide(context);
    await context.close();
  },
});

export { expect } from '@playwright/test';
