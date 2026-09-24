import 'server-only';

import { cookies } from 'next/headers';

import { getOptionalCustomerAccount } from '@/lib/customers/customer-identity';
import { mergeGuestCartIntoCustomer, newGuestToken, type CartOwner } from '@/modules/cart';

/**
 * Who is this cart's owner? (P09 §3/§19)
 *
 * The answer never comes from the request body. A signed-in customer is
 * identified by their session; a guest by a token in an httpOnly cookie the
 * browser cannot read and script cannot exfiltrate. Because no cart
 * identifier is ever accepted from the client, there is nothing for one
 * customer to substitute in order to reach another's basket — the IDOR
 * surface is absent rather than defended.
 */

export const CART_COOKIE_NAME = 'luxedrive-cart';

/** A guest cart should outlive a browser restart but not a season. */
const CART_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    // Secure everywhere but local http development, where the cookie would
    // otherwise never be set and every cart would silently be a new one.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: CART_COOKIE_MAX_AGE_SECONDS,
  };
}

/**
 * Resolves the owner for a **read**. Never writes a cookie: a Server
 * Component cannot set one, and a page render should not mint an identity
 * for someone who is only looking.
 */
export async function resolveCartOwnerForRead(): Promise<CartOwner> {
  const account = await getOptionalCustomerAccount();
  if (account) {
    return { customerId: account.customerId, guestToken: null };
  }

  const token = (await cookies()).get(CART_COOKIE_NAME)?.value ?? null;
  return { customerId: null, guestToken: token };
}

/**
 * Resolves the owner for a **write**, minting a guest token when there is
 * none yet. Only callable where a cookie may be set — a Server Action or a
 * Route Handler.
 *
 * When a signed-in customer still carries a guest cookie, their guest cart
 * is folded in here and the cookie cleared. Doing it lazily on the first
 * authenticated cart operation rather than inside a login handler means the
 * merge happens however the customer signed in, and it is safe to reach
 * twice because the merge itself is idempotent.
 */
export async function resolveCartOwnerForWrite(): Promise<CartOwner> {
  const store = await cookies();
  const account = await getOptionalCustomerAccount();

  if (account) {
    const guestToken = store.get(CART_COOKIE_NAME)?.value;

    if (guestToken) {
      await mergeGuestCartIntoCustomer({ guestToken, customerId: account.customerId });
      store.delete(CART_COOKIE_NAME);
    }

    return { customerId: account.customerId, guestToken: null };
  }

  const existing = store.get(CART_COOKIE_NAME)?.value;
  if (existing) return { customerId: null, guestToken: existing };

  const token = newGuestToken();
  store.set(CART_COOKIE_NAME, token, cookieOptions());
  return { customerId: null, guestToken: token };
}
