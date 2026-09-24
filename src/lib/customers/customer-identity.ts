import 'server-only';

import { AppError } from '@/modules/core';
import { getOptionalCustomerUser, getUserById } from '@/modules/identity';
import { resolveCustomerForUser } from '@/modules/customers';

/**
 * "Who is signed in, and which `Customer` row do they own" — composed here
 * rather than in `identity` or `customers` because it needs both, and
 * `identity` must not depend on `customers` (P12 §1's audited dependency
 * graph: `customers` depends on `identity`, never the reverse). This is the
 * same shape `cart-identity.ts` and `order-identity.ts` already use for the
 * same reason.
 *
 * Every storefront page and action that needs "the signed-in customer"
 * calls one of these two — never `getOptionalCustomerUser` directly,
 * which only proves someone is signed in, not that a `Customer` row (and
 * therefore a cart/order/payment owner id) exists for them.
 */

export interface CustomerAccount {
  userId: string;
  customerId: string;
  email: string;
  name: string | null;
}

/**
 * `name`/`email` come from a fresh `User` row read, not from the session's
 * own JWT claims: the JWT is minted at sign-in and Auth.js only refreshes
 * its `name`/`email` claims on its own cookie-rotation schedule, so a
 * profile update can otherwise leave the *session* showing the old name for
 * the rest of its session lifetime even though the database (and every
 * page that re-queries it, like the profile form's own success state)
 * already has the new one. Identity (`userId`, proven by the session) and
 * display data (`name`/`email`, read live) are kept separate on purpose —
 * the same distinction the `jwt` callback already draws for `role`/`active`,
 * extended one level up to where this composition is actually consumed.
 */
export async function getOptionalCustomerAccount(): Promise<CustomerAccount | null> {
  const sessionUser = await getOptionalCustomerUser();
  if (!sessionUser) return null;

  const [user, customer] = await Promise.all([
    getUserById(sessionUser.id),
    resolveCustomerForUser(sessionUser.id),
  ]);
  // The DB session backing this JWT was already validated by `jwt()` on the
  // same request; a `User` row missing here would mean it was deleted in
  // the instant between that check and this one — treated as signed out
  // rather than falling back to the stale session copy.
  if (!user) return null;

  return { userId: user.id, customerId: customer.id, email: user.email, name: user.name };
}

/** Throws `AppError('UNAUTHENTICATED')` rather than returning `null` — the
 * one call every protected account Server Component/Action makes first,
 * mirroring `requireUser()`'s discipline on the admin side. */
export async function requireCustomerAccount(): Promise<CustomerAccount> {
  const account = await getOptionalCustomerAccount();
  if (!account) throw new AppError('UNAUTHENTICATED');
  return account;
}
