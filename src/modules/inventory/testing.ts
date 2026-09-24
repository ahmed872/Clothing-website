import { db } from '@/modules/core';

/**
 * Test-only helper, same pattern as `catalog/testing.ts` and
 * `identity/testing.ts`: wipes the inventory history so each test starts
 * from a known state. The catalog reset already clears this table (it has
 * to — the adjustment rows pin the variants it deletes); this exists for
 * tests that want to clear history without tearing down the catalog they
 * just built.
 */
export async function resetInventoryTables(): Promise<void> {
  await db.inventoryAdjustment.deleteMany();
}
