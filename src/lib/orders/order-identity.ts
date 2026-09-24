import 'server-only';

import { cookies } from 'next/headers';

import { getOptionalCustomerAccount } from '@/lib/customers/customer-identity';
import { getOrderByAccessToken, getOrderForCustomer, type OrderView } from '@/modules/orders';

/**
 * Who may open an order (P10 §14).
 *
 * Two answers, and no third:
 *
 *   a signed-in customer  — authorised by their session, scoped in the query
 *   a guest               — authorised by an access token they were issued
 *                           at checkout
 *
 * The token lives in an httpOnly cookie and nowhere else. It is deliberately
 * *not* put in the URL: a link in the address bar leaks through the referrer
 * header, browser history, screenshots and shared links, and an order
 * contains a name, a phone number and a home address. The cookie the browser
 * cannot read is the same mechanism the guest cart already uses (P09), so
 * this is the architecture's existing answer rather than a new one.
 *
 * The cost is stated plainly: a guest who clears their cookies, or who opens
 * the link on another device, cannot reach the order any more. Recovering it
 * needs a verified email link, which requires the notification delivery P13
 * owns — building half of it here would mean an unsendable email or a
 * weaker token, and neither is worth it.
 */

export const ORDER_ACCESS_COOKIE_NAME = 'luxedrive-orders';

/** Long enough to follow an order through delivery, short enough that a
 * shared machine does not keep it forever. */
const ORDER_ACCESS_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Only the most recent few are kept: a cookie is a small, shared budget and
 * an unbounded list of tokens would eventually break every request. */
const MAX_REMEMBERED_ORDERS = 5;

interface RememberedOrder {
  number: string;
  token: string;
}

function parse(raw: string | undefined): RememberedOrder[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is RememberedOrder =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as RememberedOrder).number === 'string' &&
        typeof (entry as RememberedOrder).token === 'string',
    );
  } catch {
    // A malformed cookie is treated as no cookie. Throwing here would turn a
    // corrupted value into an unrecoverable 500 on every page load.
    return [];
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ORDER_ACCESS_MAX_AGE_SECONDS,
  };
}

/** Called once, right after a guest's order is created. Only callable where a
 * cookie may be set — a Server Action or Route Handler. */
export async function rememberGuestOrder(number: string, token: string): Promise<void> {
  const store = await cookies();
  const existing = parse(store.get(ORDER_ACCESS_COOKIE_NAME)?.value).filter(
    (entry) => entry.number !== number,
  );
  const next = [{ number, token }, ...existing].slice(0, MAX_REMEMBERED_ORDERS);
  store.set(ORDER_ACCESS_COOKIE_NAME, JSON.stringify(next), cookieOptions());
}

export async function guestTokenFor(number: string): Promise<string | null> {
  const store = await cookies();
  const found = parse(store.get(ORDER_ACCESS_COOKIE_NAME)?.value).find(
    (entry) => entry.number === number,
  );
  return found?.token ?? null;
}

export interface OrderAccess {
  order: OrderView;
  /** How the reader proved they may see it — drives whether the page offers
   * account actions or the guest notice. */
  via: 'customer' | 'guest-token';
}

/**
 * The single entry point every customer-facing order page uses.
 *
 * Returns null for "you may not see this" and for "this does not exist"
 * alike. Distinguishing them would turn the page into an oracle for which
 * order numbers are real.
 */
export async function resolveOrderAccess(number: string): Promise<OrderAccess | null> {
  const account = await getOptionalCustomerAccount();

  if (account) {
    const order = await getOrderForCustomer(number, account.customerId);
    if (order) return { order, via: 'customer' };
  }

  // Falls through for a signed-in customer too: someone who checked out as a
  // guest and signed in afterwards still holds the token for that order.
  const token = await guestTokenFor(number);
  if (!token) return null;

  const order = await getOrderByAccessToken(number, token);
  return order ? { order, via: 'guest-token' } : null;
}
