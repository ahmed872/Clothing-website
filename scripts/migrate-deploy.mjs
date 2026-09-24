/**
 * `prisma migrate deploy`, for a deployment that has no shell.
 *
 * Two things this wrapper exists for, both of which a bare
 * `prisma migrate deploy` in a build command gets wrong:
 *
 * 1. **Migrations must not run through a connection pooler.** Managed
 *    providers (Neon, Supabase, …) hand out a *pooled* string for the
 *    application and a *direct* one for schema changes; running DDL through
 *    the pooler fails or behaves unpredictably. `DATABASE_URL` stays the
 *    pooled one the running app wants, and `DIRECT_DATABASE_URL` — when
 *    set — is swapped in for the duration of this command only.
 *    docs/environments.md has said this was the deploy pipeline's job since
 *    P01; this is that pipeline.
 *
 * 2. **A deployment with no database configured should say so, once,
 *    clearly.** Prisma's own failure here is a stack trace about a driver
 *    adapter, which is what a real deploy of this project actually hit: the
 *    build died on `TableDoesNotExist` while prerendering `/ar`, several
 *    layers away from the actual cause ("nobody ever ran the migrations").
 *
 * Safe to run on every deploy: `migrate deploy` applies only what is
 * pending and is a no-op against an already-current database.
 *
 * ⚠️ Preview deployments: this runs there too, so a Preview environment
 * whose `DATABASE_URL` points at the production database would apply that
 * branch's not-yet-reviewed migrations to production. Point Preview at its
 * own database — the rule docs/environments.md already states, now with
 * teeth.
 */

import { spawnSync } from 'node:child_process';

const directUrl = process.env.DIRECT_DATABASE_URL?.trim();
const appUrl = process.env.DATABASE_URL?.trim();

if (!appUrl && !directUrl) {
  console.error(
    'migrate-deploy: DATABASE_URL is not set.\n' +
      'Set it in the deployment environment (for Vercel: Settings → Environment\n' +
      'Variables). The build cannot prerender any page without a database,\n' +
      'because the storefront reads store settings and the catalog at build time.',
  );
  process.exit(1);
}

if (directUrl) {
  console.log('migrate-deploy: using DIRECT_DATABASE_URL for migrations (not the pooled URL).');
}

const result = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: directUrl || appUrl },
});

if (result.error) {
  console.error(`migrate-deploy: could not run prisma — ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
