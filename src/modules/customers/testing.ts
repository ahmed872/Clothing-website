import { db } from '@/modules/core';

/** Test-only helper: wipes the token tables, the shared outbox (same
 * cross-module table `orders/testing.ts` also owns resetting — P12's token
 * domain uses the identical "recorded, never sent" pattern), and every
 * `User` with role CUSTOMER (cascading to their `Customer` row) —
 * foreign-key-safe order, same pattern as `identity/testing.ts`. Never
 * touches admin users. */
export async function resetCustomerTables(): Promise<void> {
  await db.emailVerificationToken.deleteMany();
  await db.passwordResetToken.deleteMany();
  await db.outboxEvent.deleteMany();
  await db.user.deleteMany({ where: { role: 'CUSTOMER' } });
}
