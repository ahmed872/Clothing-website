import { db } from '@/modules/core';

/**
 * Test-only helper: wipes every identity table in foreign-key-safe order
 * (`Session`/`AuditLog` reference `User`) — same pattern as
 * `catalog/testing.ts`. Not exported from `./index`; only reachable via a
 * deep import, which is what the `**\/*.test.ts` ESLint override exists for.
 */
export async function resetIdentityTables(): Promise<void> {
  await db.auditLog.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
}
