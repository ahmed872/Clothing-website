/**
 * Creates the first admin account during a deploy — and only when there is
 * genuinely no admin yet.
 *
 * `scripts/create-admin.mts` is the tool a person runs by hand, and it
 * deliberately *resets* the named account's password and re-asserts
 * OWNER/active every time, so it doubles as "I lost the bootstrap
 * password". That behaviour is right for a command someone types on
 * purpose and wrong for something a build runs unattended: every deploy
 * would silently reset the owner's password, and would re-enable an owner
 * account someone had deliberately disabled.
 *
 * So this one only ever *bootstraps*. If any non-CUSTOMER user already
 * exists, it changes nothing and says so. That makes it safe on every
 * deploy of a store that has been running for a year, while still meaning a
 * brand-new deployment has a way in without a shell.
 *
 * Skips silently (exit 0) when the two variables are absent — a deployment
 * that does not want this is not an error.
 *
 * Run with: pnpm db:bootstrap-admin
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env', quiet: true });

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

if (!email || !password) {
  console.log(
    'bootstrap-admin: BOOTSTRAP_ADMIN_EMAIL/BOOTSTRAP_ADMIN_PASSWORD not set — skipping.',
  );
  process.exit(0);
}

// Deep imports rather than the `@/modules/identity` barrel, for the reason
// `create-admin.mts` documents: the barrel re-exports `auth.ts`, which pulls
// in `next-auth` — a package built for Next's bundler, not a plain Node
// script runtime.
const { createUser } = await import('../src/modules/identity/user.service.js');
const { validatePasswordPolicy } = await import('../src/modules/identity/password.js');
const { db } = await import('../src/modules/core/index.js');

const existingAdmins = await db.user.count({ where: { role: { not: 'CUSTOMER' } } });

if (existingAdmins > 0) {
  console.log(
    `bootstrap-admin: ${existingAdmins} admin account(s) already exist — leaving them alone.`,
  );
  await db.$disconnect();
  process.exit(0);
}

const policyError = validatePasswordPolicy(password);
if (policyError) {
  console.error(
    `bootstrap-admin: BOOTSTRAP_ADMIN_PASSWORD does not meet the policy: ${policyError}`,
  );
  await db.$disconnect();
  process.exit(1);
}

await createUser({ email: email.toLowerCase(), password, role: 'OWNER', name: 'Owner' });
console.log(`bootstrap-admin: created the first admin account "${email.toLowerCase()}" (OWNER).`);

await db.$disconnect();
