import { db } from '@/modules/core';

/**
 * Test-only helper: empties the promotion tables. Redemptions go first —
 * they reference the coupon, the customer and the order.
 */
export async function resetPricingTables(): Promise<void> {
  await db.couponRedemption.deleteMany();
  await db.couponScope.deleteMany();
  await db.coupon.deleteMany();
}
