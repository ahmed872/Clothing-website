import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

/**
 * Accessibility (axe) and visual-regression checks against the design
 * system (P02). Both target `/dev/gallery` — the one page that renders every
 * token and component — rather than the storefront, which doesn't exist yet.
 *
 * Deliberately not multi-browser: this phase is about the design system
 * being correct, not cross-browser rendering, and running every check three
 * times over would triple CI time for no signal yet.
 */

// Some sandboxes ship a pre-installed Chromium at a fixed path instead of the
// exact revision this Playwright version would otherwise fetch on demand.
// Using it there avoids a network download; everywhere else (GitHub Actions
// included, after its own `playwright install`) this is absent and Playwright
// resolves its normally-installed browser instead.
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath = existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined;

/**
 * Chromium reaches out to Google endpoints on its own — variations/finch,
 * autofill, component updates, safe-browsing — none of which any test needs.
 * Behind an egress proxy that holds such connections open instead of
 * refusing them, those requests never settle, the page's `load` event never
 * fires, and every navigation stalls until the test times out: a browser
 * problem that reads exactly like a slow application. Turning the
 * background traffic off removes the whole class of failure.
 */
const CHROMIUM_ARGS = [
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--disable-sync',
  '--no-default-browser-check',
  '--no-first-run',
];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: CHROMIUM_ARGS, ...(executablePath ? { executablePath } : {}) },
      },
    },
  ],
  webServer: [
    {
      // `E2E_PROD_MODE=1` runs the full suite against a real `next build` +
      // `next start` instead of the dev server (P14 §10) — the strongest
      // locally-available stand-in for "test the actual deployed
      // application" when no live Vercel deployment is reachable from this
      // environment. Off by default: the ordinary dev loop (and CI's own
      // separate `pnpm build` step) still uses the fast dev server.
      // Requires `AUTH_TRUST_HOST="true"` in `.env` — `next start` sets
      // `NODE_ENV=production`, which the env schema requires it for (P14;
      // see AUTH_TRUST_HOST's own doc comment in env.schema.ts for why).
      command: process.env.E2E_PROD_MODE ? 'pnpm build && pnpm start' : 'pnpm dev',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: !process.env.CI,
      // 60s was enough until the app grew: on a cold `.next/dev` and the
      // slow filesystem this sandbox warns about, Turbopack's first compile
      // now runs past a minute and Playwright gave up before the server was
      // ready — a boot that was still working, reported as a failure. A
      // production build is slower still, so `E2E_PROD_MODE` gets extra room.
      timeout: process.env.E2E_PROD_MODE ? 300_000 : 180_000,
    },
    /**
     * The payment provider (P11).
     *
     * A stand-in for the vendor, not for us: it speaks the hosted-checkout
     * contract, hosts a payment page, and signs its webhooks with the real
     * `PAYMENT_WEBHOOK_SECRET` using the real HMAC construction. The
     * application verifies those deliveries with its own production code and
     * refuses the ones that do not verify. Point `PAYMENT_API_BASE_URL` at a
     * vendor sandbox and the same specs exercise the same paths — what is
     * unavailable in this environment is a vendor account, not the logic.
     */
    {
      command: 'pnpm payments:stub',
      url: 'http://127.0.0.1:4011/__test/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
