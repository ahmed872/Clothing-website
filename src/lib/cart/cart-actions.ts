'use server';

import {
  addItem,
  clearCart,
  removeItem,
  setCartCoupon,
  updateItemQuantity,
  getCartView,
  getCartItemCount,
  type CartView,
} from '@/modules/cart';
import { normalizeCouponCode } from '@/modules/pricing';
import type { Locale } from '@/lib/i18n/locales';
import type { ActionResult } from '@/lib/admin/action-result';

import { resolveCartOwnerForRead, resolveCartOwnerForWrite } from './cart-identity';
import { cartErrorMessage, couponRejectionMessage } from './cart-messages';

/**
 * Everything a customer can do to their own cart.
 *
 * Note what these actions do *not* take: no cart id, no price, no subtotal,
 * no discount, no currency. A caller may name a variant, a quantity and a
 * promotion code; every other number is derived on the server (P09 §4). A
 * tampered payload has nothing to tamper with — the extra fields do not
 * exist in the signature, so there is no field to ignore and no field to
 * accidentally start trusting later.
 *
 * Each action returns the freshly recalculated cart, so the page renders
 * server truth instead of optimistically patching a local copy.
 *
 * Nothing here calls `revalidatePath`: the cart page reads a cookie and is
 * therefore dynamic already, and the storefront's cached category and
 * product pages have nothing cart-shaped in them to invalidate. Blanket
 * revalidation on every quantity click would throw away P05's ISR for no
 * gain (P09 §23 — do not disable caching, target it).
 */

async function withCart(
  locale: Locale,
  operation: () => Promise<void>,
): Promise<ActionResult<CartView>> {
  try {
    await operation();
    const cart = await getCartView(await resolveCartOwnerForRead());
    return { ok: true, data: cart };
  } catch (error) {
    return { ok: false, error: cartErrorMessage(error, locale) };
  }
}

export async function addToCartAction(
  input: { variantId: string; quantity: number },
  locale: Locale,
): Promise<ActionResult<CartView>> {
  return withCart(locale, async () => {
    await addItem(await resolveCartOwnerForWrite(), input);
  });
}

export async function updateCartQuantityAction(
  input: { variantId: string; quantity: number },
  locale: Locale,
): Promise<ActionResult<CartView>> {
  return withCart(locale, async () => {
    await updateItemQuantity(await resolveCartOwnerForWrite(), input);
  });
}

export async function removeFromCartAction(
  variantId: string,
  locale: Locale,
): Promise<ActionResult<CartView>> {
  return withCart(locale, async () => {
    await removeItem(await resolveCartOwnerForWrite(), variantId);
  });
}

export async function clearCartAction(locale: Locale): Promise<ActionResult<CartView>> {
  return withCart(locale, async () => {
    await clearCart(await resolveCartOwnerForWrite());
  });
}

/**
 * Attaching a promotion code.
 *
 * The code is stored, the cart is recalculated, and the *recalculation* is
 * what decides the answer — there is deliberately no separate pre-check
 * here. A second evaluation path would be a second set of scope rules to
 * keep in step with the first, and the two would eventually disagree about
 * some cart nobody thought to test (P09 §24).
 *
 * A code that turns out not to apply is not left attached: it is removed
 * again, so the cart never shows a promotion that discounts nothing.
 *
 * Storing a code consumes nothing. Entering a promotion is not a
 * redemption; that happens only once an order exists (P10).
 */
export async function applyCouponAction(
  rawCode: string,
  locale: Locale,
): Promise<ActionResult<CartView>> {
  const code = normalizeCouponCode(rawCode);
  if (code.length === 0) {
    return { ok: false, error: couponRejectionMessage('not_found', locale) };
  }

  try {
    const owner = await resolveCartOwnerForWrite();
    const previous = (await getCartView(owner)).coupon?.code ?? null;

    await setCartCoupon(owner, code);
    const updated = await getCartView(owner);

    if (updated.coupon && !updated.coupon.applied) {
      // Put back whatever was there before, so a failed attempt cannot
      // knock off a promotion that was working.
      await setCartCoupon(owner, previous);
      return {
        ok: false,
        error: couponRejectionMessage(
          updated.coupon.rejection ?? 'not_found',
          locale,
          updated.coupon.minOrderMinor ?? undefined,
        ),
      };
    }

    return { ok: true, data: updated };
  } catch (error) {
    return { ok: false, error: cartErrorMessage(error, locale) };
  }
}

export async function removeCouponAction(locale: Locale): Promise<ActionResult<CartView>> {
  return withCart(locale, async () => {
    await setCartCoupon(await resolveCartOwnerForWrite(), null);
  });
}

/** Re-reads the cart without changing it. Every read recalculates, so this
 * is how a page refreshes after something outside it (a price change, a
 * promotion being switched off) may have altered the answer. */
export async function getCartAction(locale: Locale): Promise<ActionResult<CartView>> {
  try {
    return { ok: true, data: await getCartView(await resolveCartOwnerForRead()) };
  } catch (error) {
    return { ok: false, error: cartErrorMessage(error, locale) };
  }
}

/** The header badge. Kept separate from `getCartView` so the storefront
 * layout can stay cached while one small client component asks for a live
 * number. */
export async function getCartCountAction(): Promise<number> {
  return getCartItemCount(await resolveCartOwnerForRead());
}
