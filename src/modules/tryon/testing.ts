import { db } from '@/modules/core';

/** Test-only: empties the try-on job table. */
export async function resetTryOnTables(): Promise<void> {
  await db.tryOnJob.deleteMany();
}
