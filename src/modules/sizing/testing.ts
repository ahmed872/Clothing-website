import { db } from '@/modules/core';

/** Test-only: empties the sizing tables (entries first, for the FK). */
export async function resetSizingTables(): Promise<void> {
  await db.sizeChartEntry.deleteMany();
  await db.productSizing.deleteMany();
}
