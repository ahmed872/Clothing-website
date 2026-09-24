import { db } from '@/modules/core';

/** Clears the payment tables between tests, children first. */
export async function resetPaymentTables(): Promise<void> {
  await db.webhookEvent.deleteMany();
  await db.payment.deleteMany();
}
