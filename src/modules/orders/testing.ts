import { db } from '@/modules/core';

/**
 * Test-only helper, same pattern as `cart/testing.ts`. Order rows are deleted
 * last-referenced-first: events, items and redemptions all point at the
 * order, and inventory adjustments point at it optionally.
 */
export async function resetOrderTables(): Promise<void> {
  await db.orderEvent.deleteMany();
  await db.orderItem.deleteMany();
  await db.couponRedemption.deleteMany();
  await db.inventoryAdjustment.deleteMany();
  await db.outboxEvent.deleteMany();
  await db.auditLog.deleteMany();
  await db.order.deleteMany();
}
