import { db } from '@/modules/core';

/**
 * Test-only helper, same pattern as `catalog/testing.ts`: empties the cart
 * tables so each test starts from a known state. Items go first — they
 * reference both the cart and the variant.
 */
export async function resetCartTables(): Promise<void> {
  await db.cartItem.deleteMany();
  await db.cart.deleteMany();
}
