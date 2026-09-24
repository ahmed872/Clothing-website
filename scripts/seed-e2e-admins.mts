/**
 * P06 e2e test fixtures — creates the fixed accounts `e2e/admin-*.spec.ts`
 * log in as. Not the bootstrap flow (`create-admin.mts`) itself; this is
 * the test-only equivalent for exercising more than the OWNER role (a
 * STAFF account, to prove a section its role lacks stays blocked when
 * reached by direct URL, and a disabled account, to prove login is
 * actually refused). These credentials never reach `src/` or the built
 * app — only this dev-only script and the e2e specs that import nothing
 * from it (they just know the fixed values) ever see them.
 *
 * Idempotent, like `create-admin.mts`: safe to run before every e2e run.
 *
 * Run with: pnpm db:seed-e2e-admins
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env', quiet: true });

const { createUser, getUserByEmail } = await import('../src/modules/identity/user.service.js');
const { hashPassword } = await import('../src/modules/identity/password.js');
const { db } = await import('../src/modules/core/index.js');
const {
  E2E_OWNER,
  E2E_STAFF,
  E2E_MANAGER,
  E2E_DISABLED,
  E2E_ACCEPTANCE_OWNER,
  E2E_USERS_OWNER,
  E2E_CONTENT_OWNER,
  E2E_ANALYTICS_OWNER,
  E2E_SETTINGS_OWNER,
} = await import('../e2e/fixtures/admin-credentials.js');

async function upsertAdmin(
  email: string,
  password: string,
  role: 'OWNER' | 'MANAGER' | 'STAFF',
  active: boolean,
): Promise<void> {
  const existing = await getUserByEmail(email);
  if (existing) {
    await db.user.update({
      where: { id: existing.id },
      data: { passwordHash: await hashPassword(password), role, active },
    });
    return;
  }

  const created = await createUser({ email, password, role, name: `E2E ${role}` });
  if (!active) {
    await db.user.update({ where: { id: created.id }, data: { active: false } });
  }
}

await upsertAdmin(E2E_OWNER.email, E2E_OWNER.password, 'OWNER', true);
await upsertAdmin(E2E_STAFF.email, E2E_STAFF.password, 'STAFF', true);
await upsertAdmin(E2E_MANAGER.email, E2E_MANAGER.password, 'MANAGER', true);
await upsertAdmin(E2E_DISABLED.email, E2E_DISABLED.password, 'OWNER', false);
await upsertAdmin(E2E_ACCEPTANCE_OWNER.email, E2E_ACCEPTANCE_OWNER.password, 'OWNER', true);
await upsertAdmin(E2E_USERS_OWNER.email, E2E_USERS_OWNER.password, 'OWNER', true);
await upsertAdmin(E2E_CONTENT_OWNER.email, E2E_CONTENT_OWNER.password, 'OWNER', true);
await upsertAdmin(E2E_ANALYTICS_OWNER.email, E2E_ANALYTICS_OWNER.password, 'OWNER', true);
await upsertAdmin(E2E_SETTINGS_OWNER.email, E2E_SETTINGS_OWNER.password, 'OWNER', true);

console.log(
  '✓ e2e admin fixtures ready: e2e-owner, e2e-staff, e2e-manager, e2e-disabled, e2e-acceptance, e2e-users-owner, e2e-content-owner, e2e-analytics-owner, e2e-settings-owner',
);
await db.$disconnect();
