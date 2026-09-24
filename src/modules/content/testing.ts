import { db } from '@/modules/core';

/** Test-only: wipes the homepage sections table. Not exported from
 * `./index`; only reachable via a deep import, same as every other
 * module's `testing.ts`. */
export async function resetContentTables(): Promise<void> {
  await db.homepageSection.deleteMany();
}
