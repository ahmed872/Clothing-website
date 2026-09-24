import { db } from '@/modules/core';

/** Test-only: removes every body profile (avatar configurations go with
 * them by cascade, and are cleared first anyway so the order never
 * matters). Not exported from `./index`, same as every module's
 * `testing.ts`. */
export async function resetBodyProfileTables(): Promise<void> {
  await db.avatarConfiguration.deleteMany();
  await db.bodyProfile.deleteMany();
}
