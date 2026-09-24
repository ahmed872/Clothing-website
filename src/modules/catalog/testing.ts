import { db } from '@/modules/core';

/**
 * Test-only helper: wipes every catalog table in foreign-key-safe order.
 * Used by this module's own tests (`beforeEach`) so each test starts from an
 * empty catalog rather than depending on ordering or leftover state from a
 * previous test — see docs/environments.md ("wiped and recreated by the test
 * run"). Not exported from `./index`; only reachable via a deep import,
 * which is exactly what the `**\/*.test.ts` ESLint override exists for.
 */
export async function resetCatalogTables(): Promise<void> {
  // `InventoryAdjustment.variant` is `onDelete: Restrict` (P08): stock
  // history pins the variant it describes, so it has to go first or the
  // variant delete below is refused.
  await db.inventoryAdjustment.deleteMany();
  // `CartItem.variant` is `onDelete: Restrict` too (P09): a basket pins the
  // variant it holds, for the same reason stock history does.
  await db.cartItem.deleteMany();
  await db.variantOptionValue.deleteMany();
  await db.productImage.deleteMany();
  await db.variant.deleteMany();
  await db.optionValue.deleteMany();
  await db.productOption.deleteMany();
  await db.product.deleteMany();
  await db.attributeDefinition.deleteMany();
  await db.category.deleteMany();
  await db.brand.deleteMany();
}
