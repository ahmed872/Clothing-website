/**
 * P06 bootstrap — creates the very first admin account (`OWNER` role, i.e.
 * Super Admin). This is the *only* path that may ever create an admin user
 * out of nothing: there is no signup form, no seed data, and no hardcoded
 * account anywhere in this codebase (the legacy `admin/admin123` account
 * was deleted in P00 and must never return).
 *
 * Credentials come only from environment variables, read directly from
 * `process.env` here and nowhere else — `BOOTSTRAP_ADMIN_EMAIL` and
 * `BOOTSTRAP_ADMIN_PASSWORD` are deliberately excluded from
 * `env.schema.ts`'s validated `serverEnv()` (see the comment there) so they
 * can never leak into a page, a log line, or any code path that runs as
 * part of the app itself — this script is the one place they are read, and
 * the process exits the moment it's done with them.
 *
 * Idempotent: running it again against an email that already exists resets
 * that user's password and re-asserts OWNER/active, rather than failing —
 * so it doubles as "reset the bootstrap admin's password" if it's ever
 * lost. It never creates a second bootstrap account by accident.
 *
 * Run with: pnpm db:create-admin
 *   BOOTSTRAP_ADMIN_EMAIL=owner@example.com BOOTSTRAP_ADMIN_PASSWORD='...' pnpm db:create-admin
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env', quiet: true });

const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

if (!email || !password) {
  console.error(
    'BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must both be set in the environment.\n' +
      "Example: BOOTSTRAP_ADMIN_EMAIL=owner@example.com BOOTSTRAP_ADMIN_PASSWORD='...' pnpm db:create-admin",
  );
  process.exit(1);
}

// Deep imports, not the `@/modules/identity` barrel: the barrel also
// re-exports `auth.ts`, which pulls in `next-auth` — a package built for
// Next.js's own bundler, not a plain Node script runtime, and importing it
// here breaks on a React-context mismatch. This script only ever needs the
// two files below, neither of which touches `next-auth`.
const { createUser, getUserByEmail } = await import('../src/modules/identity/user.service.js');
const { hashPassword, validatePasswordPolicy } =
  await import('../src/modules/identity/password.js');
const { db } = await import('../src/modules/core/index.js');

const policyError = validatePasswordPolicy(password);
if (policyError) {
  console.error(`BOOTSTRAP_ADMIN_PASSWORD does not meet the password policy: ${policyError}`);
  process.exit(1);
}

const normalizedEmail = email.trim().toLowerCase();
const existing = await getUserByEmail(normalizedEmail);

if (existing) {
  const passwordHash = await hashPassword(password);
  await db.user.update({
    where: { id: existing.id },
    data: { passwordHash, role: 'OWNER', active: true },
  });
  console.log(
    `✓ Existing user "${normalizedEmail}" updated: password reset, role set to OWNER, active.`,
  );
} else {
  await createUser({ email: normalizedEmail, password, role: 'OWNER', name: 'Owner' });
  console.log(`✓ Admin account "${normalizedEmail}" created with role OWNER.`);
}

await db.$disconnect();
