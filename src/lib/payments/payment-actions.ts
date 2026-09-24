'use server';

import { revalidatePath } from 'next/cache';

import { clientEnv } from '@/modules/core';
import { isAppError, toAppError } from '@/modules/core';
import { findLiveAttempt, isPaymentEnabled } from '@/modules/payments';
import { startPaymentForOrder, syncAttemptFromProvider } from '@/modules/orders';
import type { Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import type { ActionResult } from '@/lib/admin/action-result';
import { resolveOrderAccess } from '@/lib/orders/order-identity';

/**
 * Starting and refreshing a payment, from the customer's side (P11 §9).
 *
 * Note what these actions do *not* take: no amount, no currency, no payment
 * id, no provider reference, no status. The only input is an order *number*,
 * and it is resolved through `resolveOrderAccess` — P10's single authority on
 * who may see an order, which scopes by session for a customer and by an
 * httpOnly token cookie for a guest, and answers "not yours" and "does not
 * exist" identically.
 *
 * That is what makes substituting an identifier useless here: there is no
 * payment id to substitute, and an order number the caller cannot open
 * resolves to null before any payment code runs.
 */

export interface StartPaymentActionData {
  /** Provider-issued. The browser is sent here; it is not a store URL and
   * carries no credential of ours. */
  checkoutUrl: string;
  status: string;
}

function messageFor(locale: Locale, code: string, reasonCode?: unknown): string {
  const t = getDictionary(locale).payment;
  if (reasonCode === 'already_paid') return t.errorAlreadyPaid;
  if (reasonCode === 'cancelled' || reasonCode === 'not_payable_status') {
    return t.errorNotPayable;
  }
  if (reasonCode === 'payments_disabled') return t.errorUnavailable;
  switch (code) {
    case 'NOT_FOUND':
      return t.errorNotFound;
    case 'PAYMENT_FAILED':
      return t.errorProvider;
    default:
      return t.errorGeneric;
  }
}

/** Absolute, and built from configuration rather than a request header. A
 * return URL taken from `Host` or `Referer` is a redirect an attacker
 * controls, and it would be handed to the provider to send the customer to. */
function returnUrlFor(locale: Locale, orderNumber: string): string {
  const origin = clientEnv().NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '');
  return `${origin}/${locale}/order/${orderNumber}/payment`;
}

export async function startPaymentAction(
  locale: Locale,
  orderNumber: string,
): Promise<ActionResult<StartPaymentActionData>> {
  try {
    if (!isPaymentEnabled()) {
      return { ok: false, error: getDictionary(locale).payment.errorUnavailable };
    }

    const access = await resolveOrderAccess(orderNumber);
    // Same answer for "not yours" and "does not exist", so this cannot be
    // used to discover which order numbers are real.
    if (!access) {
      return { ok: false, error: getDictionary(locale).payment.errorNotFound };
    }

    const { payment } = await startPaymentForOrder({
      orderId: access.order.id,
      returnUrl: returnUrlFor(locale, access.order.number),
    });

    if (!payment.checkoutUrl) {
      return { ok: false, error: getDictionary(locale).payment.errorProvider };
    }

    revalidatePath(`/${locale}/order/${orderNumber}/success`);
    return { ok: true, data: { checkoutUrl: payment.checkoutUrl, status: payment.status } };
  } catch (error) {
    const appError = toAppError(error);
    if (!isAppError(error)) {
      // Code and shape only. A payment error's cause can carry a provider
      // response, and a provider response can carry the customer's details.
      console.error('startPaymentAction failed', appError.code);
    }
    return {
      ok: false,
      error: messageFor(locale, appError.code, appError.details?.reasonCode),
    };
  }
}

export interface RefreshPaymentActionData {
  status: string | null;
  orderPaymentStatus: string;
}

/**
 * Asks the provider what it actually thinks, then reports the stored result
 * (P11 §19).
 *
 * This is what the return page calls instead of reading a query parameter.
 * The answer comes from an authenticated server-to-server lookup and is
 * applied through the same verified-event path a webhook uses — there is no
 * shortcut here that a webhook does not also take.
 */
export async function refreshPaymentAction(
  locale: Locale,
  orderNumber: string,
): Promise<ActionResult<RefreshPaymentActionData>> {
  try {
    const access = await resolveOrderAccess(orderNumber);
    if (!access) {
      return { ok: false, error: getDictionary(locale).payment.errorNotFound };
    }

    const live = await findLiveAttempt(access.order.id);
    if (live) await syncAttemptFromProvider(live.id);

    const refreshed = await resolveOrderAccess(orderNumber);
    revalidatePath(`/${locale}/order/${orderNumber}/payment`);
    revalidatePath(`/${locale}/order/${orderNumber}/success`);

    return {
      ok: true,
      data: {
        status: live?.status ?? null,
        orderPaymentStatus: refreshed?.order.paymentStatus ?? access.order.paymentStatus,
      },
    };
  } catch (error) {
    const appError = toAppError(error);
    if (!isAppError(error)) console.error('refreshPaymentAction failed', appError.code);
    return { ok: false, error: messageFor(locale, appError.code) };
  }
}
