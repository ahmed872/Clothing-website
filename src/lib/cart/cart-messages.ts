import { formatMoney, toAppError } from '@/modules/core';
import type { CouponRejection } from '@/modules/pricing';
import { getDictionary } from '@/lib/i18n/dictionary';
import type { Locale } from '@/lib/i18n/locales';

/**
 * What a customer is told when something goes wrong (P09 §9).
 *
 * The domain throws locale-free reasons; this is the one place they become
 * sentences, the same separation `adminErrorMessage` draws for the admin.
 *
 * The line between helpful and leaky is drawn deliberately:
 *
 *  - "expired", "not started yet" and "you have already used this" are
 *    facts about the customer's own situation. Saying them plainly is
 *    useful and reveals nothing they could not work out by trying again
 *    tomorrow.
 *  - "there is no such code" and "this code is switched off" collapse into
 *    one message. Distinguishing them would turn the coupon box into an
 *    oracle for guessing which codes exist.
 *  - "not enough usages left" never names how many remain, and a scope
 *    rejection never names what the promotion covers — a customer does not
 *    need the store's configuration to understand that this code is not for
 *    this basket.
 */
export function couponRejectionMessage(
  reason: CouponRejection,
  locale: Locale,
  minOrderMinor?: number,
): string {
  const t = getDictionary(locale).cart.couponErrors;

  switch (reason) {
    case 'expired':
      return t.expired;
    case 'not_started':
      return t.notStarted;
    case 'usage_limit_reached':
      return t.noLongerAvailable;
    case 'customer_limit_reached':
      return t.alreadyUsed;
    case 'below_minimum':
      return minOrderMinor === undefined
        ? t.belowMinimumGeneric
        : t.belowMinimum.replace('{amount}', formatMoney(minOrderMinor, { locale }));
    case 'no_eligible_items':
      return t.notForTheseItems;
    case 'not_found':
    case 'inactive':
    default:
      // Deliberately identical for both: an unknown code and a disabled one
      // must be indistinguishable from outside.
      return t.invalid;
  }
}

/** Domain failures on the cart itself. Falls back to the error code's own
 * customer-facing message, which every `AppError` already carries in both
 * languages. */
export function cartErrorMessage(error: unknown, locale: Locale): string {
  const appError = toAppError(error);
  const t = getDictionary(locale).cart.errors;
  const reasonCode = appError.details?.reasonCode;

  if (typeof reasonCode === 'string') {
    switch (reasonCode) {
      case 'variant_out_of_stock':
        return t.outOfStock;
      case 'quantity_above_stock': {
        const available = appError.details?.available;
        return typeof available === 'number'
          ? t.onlySoManyLeft.replace('{count}', String(available))
          : t.outOfStock;
      }
      case 'invalid_quantity':
        return t.invalidQuantity;
      default:
        break;
    }
  }

  return appError.messageFor(locale);
}
