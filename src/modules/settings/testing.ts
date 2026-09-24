import { db } from '@/modules/core';

/** Test-only: wipes the (single-row) settings table. Not exported from
 * `./index`; only reachable via a deep import, same as every other
 * module's `testing.ts`. */
export async function resetSettingsTable(): Promise<void> {
  await db.storeSettings.deleteMany();
}
