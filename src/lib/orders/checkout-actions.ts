'use server';

import { revalidatePath } from 'next/cache';

import { isAppError, toAppError } from '@/modules/core';
import { placeOrder, type PlaceOrderInput } from '@/modules/orders';
import type { Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import type { ActionResult } from '@/lib/admin/action-result';
import { resolveCartOwnerForWrite } from '@/lib/cart/cart-identity';
import { getOptionalCustomerAccount } from '@/lib/customers/customer-identity';

import { rememberGuestOrder } from './order-identity';

/**
 * Placing an order.
 *
 * Note what this action does *not* take: no cart id, no price, no subtotal,
 * no discount, no total, no currency, no status. The caller supplies contact
 * details, an address, an optional note and an idempotency key; every number
 * is derived on the server from the cart it owns (P10 §5). There is no field
 * for a tampered payload to set, which is stronger than validating one.
 *
 * The cart owner comes from the session or the httpOnly cart cookie — never
 * from the request body — so one customer cannot check out another's basket
 * by substituting an identifier (the P09 design, unchanged).
 */

export interface PlaceOrderActionData {
  number: string;
  /** Where to send the browser next. Built here rather than in the client so
   * the client never has to know the locale routing rules. */
  successPath: string;
}

function messageFor(locale: Locale, code: string): string {
  const t = getDictionary(locale).checkout;
  switch (code) {
    case 'VALIDATION_FAILED':
      return t.errorCartEmpty;
    case 'OUT_OF_STOCK':
      return t.errorOutOfStock;
    case 'COUPON_INVALID':
    case 'COUPON_EXPIRED':
    case 'COUPON_LIMIT_REACHED':
      return t.errorCouponInvalid;
    case 'PRICE_CHANGED':
      return t.errorPriceChanged;
    default:
      return t.errorGeneric;
  }
}

export async function placeOrderAction(
  locale: Locale,
  input: PlaceOrderInput,
): Promise<ActionResult<PlaceOrderActionData>> {
  try {
    const owner = await resolveCartOwnerForWrite();
    const { order, accessToken } = await placeOrder({ owner, input });

    // A guest is handed the credential for their own order, in an httpOnly
    // cookie. Signed-in customers are authorised by their session and get
    // nothing extra.
    if (accessToken) {
      await rememberGuestOrder(order.number, accessToken);
    }

    // Targeted revalidation (P10 §25): the cart is now empty and the
    // customer has a new order. The storefront's cached category and product
    // pages are left alone — stock changed, but availability is resolved at
    // request time, and blanket revalidation would throw away P05's ISR.
    revalidatePath(`/${locale}/cart`);
    if (await getOptionalCustomerAccount()) {
      revalidatePath(`/${locale}/account/orders`);
    }

    return {
      ok: true,
      data: {
        number: order.number,
        successPath: `/${locale}/order/${order.number}/success`,
      },
    };
  } catch (error) {
    const appError = toAppError(error);
    // Domain failures come back as a message the customer can act on;
    // anything else is logged as itself and shown as the generic message,
    // because an unexpected error has no user-facing advice worth inventing.
    if (!isAppError(error)) {
      console.error('placeOrderAction failed', appError.cause ?? appError);
    }
    return { ok: false, error: messageFor(locale, appError.code) };
  }
}
