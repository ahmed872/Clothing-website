/**
 * Removes homepage sections left behind by
 * `e2e/admin-content-acceptance.spec.ts`.
 *
 * That spec is the only one in the suite that writes to *global* storefront
 * state: a `HomepageSection` renders on `/ar` and `/en` for everyone, so a
 * section surviving a failed test does not merely linger — it appears on
 * the homepage every later spec loads.
 *
 * Two modes, and the distinction matters because the suite runs
 * `fullyParallel`:
 *
 *   - **With titles as arguments** — delete exactly those. This is what the
 *     spec calls after each test, and it is safe while sibling workers are
 *     mid-test because it can only ever name sections this worker created.
 *   - **With no arguments** — delete every section carrying the marker.
 *     This is a sweep for debris from a previous, aborted run, and must be
 *     run when no test is in flight (by hand, or before the suite starts),
 *     never from a per-worker hook: it would happily delete the section a
 *     concurrently running worker is in the middle of asserting on.
 *
 * Either way it matches on the marker in the section's own English title,
 * so it can never touch a real or demo-seeded section.
 *
 * Run with: pnpm db:cleanup-e2e-content [title...]
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env', quiet: true });

const { db } = await import('../src/modules/core/index.js');
const { E2E_CONTENT_TITLE_MARKER } = await import('../e2e/fixtures/content-fixture.js');

const titles = process.argv.slice(2).filter((value) => value.startsWith(E2E_CONTENT_TITLE_MARKER));

const { count } = await db.homepageSection.deleteMany({
  where:
    titles.length > 0
      ? { OR: titles.map((titleEn) => ({ config: { path: ['titleEn'], equals: titleEn } })) }
      : { config: { path: ['titleEn'], string_starts_with: E2E_CONTENT_TITLE_MARKER } },
});

console.log(`✓ removed ${count} e2e homepage section(s)`);
await db.$disconnect();
