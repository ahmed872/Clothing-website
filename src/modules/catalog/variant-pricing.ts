import type { Variant } from '@generated/prisma';

/**
 * "What does this variant cost right now" — a display concern that belongs
 * to `catalog` because it only ever reads fields already on `Variant`
 * (`priceMinor`, `salePriceMinor`, the sale window). It is deliberately not
 * part of `pricing`: there are no coupons, no cart totals, no tax here — the
 * real pricing engine (discounts, coupon evaluation, order totals) is P09's
 * `pricing` module, not this. This is the one place "is a sale currently
 * active" is decided, so a listing card and a product page can never
 * disagree about it.
 *
 * All amounts stay integer minor units throughout — no float ever touches a
 * price (ADR-006/ADR-022, `core/money.ts`).
 */
export interface EffectivePrice {
  /** What a customer pays right now. */
  currentMinor: number;
  /** The struck-through original, or `null` when there is nothing to compare against. */
  compareAtMinor: number | null;
  onSale: boolean;
}

function saleIsActive(
  variant: Pick<Variant, 'salePriceMinor' | 'saleStartsAt' | 'saleEndsAt'>,
  now: Date,
): boolean {
  if (variant.salePriceMinor == null) return false;
  if (variant.saleStartsAt && now < variant.saleStartsAt) return false;
  if (variant.saleEndsAt && now > variant.saleEndsAt) return false;
  return true;
}

export function resolveEffectivePrice(
  variant: Pick<
    Variant,
    'priceMinor' | 'compareAtMinor' | 'salePriceMinor' | 'saleStartsAt' | 'saleEndsAt'
  >,
  now: Date = new Date(),
): EffectivePrice {
  if (saleIsActive(variant, now)) {
    // A sale price always compares against the regular price — that's the
    // discount a customer is actually seeing — falling back to an explicit
    // compareAtMinor only if it's higher still (a pre-discounted MSRP).
    const compareAtMinor =
      Math.max(variant.priceMinor, variant.compareAtMinor ?? 0) || variant.priceMinor;
    return { currentMinor: variant.salePriceMinor!, compareAtMinor, onSale: true };
  }

  const hasCompareAt =
    variant.compareAtMinor != null && variant.compareAtMinor > variant.priceMinor;
  return {
    currentMinor: variant.priceMinor,
    compareAtMinor: hasCompareAt ? variant.compareAtMinor : null,
    onSale: false,
  };
}

/** The representative price for a multi-variant product: the lowest current
 * price across its variants, the classic "From SAR X" listing-card price.
 * Throws on an empty list — a product with zero variants can't reach this
 * point (`assertPublishable` refuses to publish one). */
export function resolveListingPrice(
  variants: readonly Parameters<typeof resolveEffectivePrice>[0][],
  now: Date = new Date(),
): EffectivePrice {
  if (variants.length === 0) {
    throw new Error('resolveListingPrice requires at least one variant');
  }
  return variants
    .map((variant) => resolveEffectivePrice(variant, now))
    .reduce((lowest, price) => (price.currentMinor < lowest.currentMinor ? price : lowest));
}
