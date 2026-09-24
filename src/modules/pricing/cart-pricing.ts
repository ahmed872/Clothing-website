import { applyPercentage, assertMinor, sumMinor, DEFAULT_CURRENCY } from '@/modules/core';

/**
 * The one place a cart total is computed (P09 §7).
 *
 * Deliberately pure: it takes resolved lines and an optional already-validated
 * coupon and returns numbers. No database, no session, no clock of its own —
 * the caller resolves the authoritative unit price from the catalog and the
 * coupon from `pricing`'s own service, then hands both here. That is what
 * makes a total reproducible: the same inputs always produce the same
 * result, which is the property `orders` and `payments` will later depend on.
 *
 * Every amount is an integer in the currency's minor unit (ADR-006/ADR-022).
 * No float ever touches a total; percentages go through `applyPercentage`,
 * the same rounding rule the rest of the platform uses.
 */

export type CouponKind = 'PERCENTAGE' | 'FIXED';

/** One cart line, with its price already resolved from the catalog. The
 * client never supplies any of this except `quantity`. */
export interface PricingLineInput {
  variantId: string;
  productId: string;
  categoryId: string;
  brandId: string | null;
  quantity: number;
  /** What this variant costs right now, from `resolveEffectivePrice`. */
  unitPriceMinor: number;
}

/** The coupon as the calculator needs it — already checked for validity by
 * `evaluateCoupon`; this step only spreads the money. */
export interface AppliedCouponInput {
  id: string;
  code: string;
  type: CouponKind;
  value: number;
  maxDiscountMinor: number | null;
  /** Which lines the coupon may discount. Empty means "every line". */
  eligibleVariantIds: readonly string[] | null;
}

export interface PricedLine {
  variantId: string;
  productId: string;
  quantity: number;
  unitPriceMinor: number;
  lineSubtotalMinor: number;
  /** This line's share of the cart discount, allocated so the shares sum
   * exactly to `discountMinor` — no drift between the lines and the total. */
  lineDiscountMinor: number;
  lineTotalMinor: number;
  /** Whether the coupon's scope covers this line. */
  discountEligible: boolean;
}

export interface CartPricing {
  lines: PricedLine[];
  currency: string;
  subtotalMinor: number;
  /** The part of the subtotal the coupon was allowed to discount. */
  eligibleSubtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  coupon: { id: string; code: string; type: CouponKind; value: number } | null;
}

function lineSubtotal(line: PricingLineInput): number {
  assertMinor(line.unitPriceMinor);
  if (!Number.isInteger(line.quantity) || line.quantity < 0) {
    throw new Error(`Cart quantity must be a non-negative integer, received: ${line.quantity}`);
  }
  return line.unitPriceMinor * line.quantity;
}

/**
 * The raw discount a coupon asks for, before it is capped.
 *
 * A percentage applies to the eligible subtotal only — a "10% off shoes"
 * coupon must not discount the jacket in the same cart.
 */
export function rawDiscountFor(
  coupon: Pick<AppliedCouponInput, 'type' | 'value'>,
  eligibleSubtotalMinor: number,
): number {
  if (coupon.type === 'PERCENTAGE') {
    return applyPercentage(eligibleSubtotalMinor, coupon.value);
  }
  assertMinor(coupon.value);
  return coupon.value;
}

/**
 * Caps the discount so it can never exceed what it is allowed to discount,
 * and never exceeds an explicit maximum. Both bounds matter: without the
 * first, a 500 SAR fixed coupon on a 200 SAR cart would produce a negative
 * total; without the second, a percentage coupon ignores its own ceiling.
 */
export function capDiscount(
  raw: number,
  eligibleSubtotalMinor: number,
  maxDiscountMinor: number | null,
): number {
  const ceiling =
    maxDiscountMinor === null
      ? eligibleSubtotalMinor
      : Math.min(maxDiscountMinor, eligibleSubtotalMinor);
  return Math.max(0, Math.min(raw, ceiling));
}

/**
 * Splits a cart-level discount across the eligible lines proportionally to
 * their subtotals, by the largest-remainder method: floor every share, then
 * hand the leftover halalas to the lines with the largest fractional part,
 * breaking ties by line order so the result is deterministic.
 *
 * Rounding each line independently would let the shares sum to one halala
 * more or less than the discount actually applied — a discrepancy that shows
 * up later as an invoice whose lines do not add up to its total.
 */
export function allocateDiscount(
  eligibleSubtotals: readonly number[],
  discountMinor: number,
): number[] {
  const total = sumMinor(eligibleSubtotals);
  if (total <= 0 || discountMinor <= 0) return eligibleSubtotals.map(() => 0);

  const exact = eligibleSubtotals.map((subtotal) => (subtotal * discountMinor) / total);
  const shares = exact.map((value) => Math.floor(value));
  let remainder = discountMinor - shares.reduce((sum, share) => sum + share, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let i = 0; remainder > 0 && i < order.length; i += 1) {
    const target = order[i]!.index;
    shares[target] = shares[target]! + 1;
    remainder -= 1;
  }
  return shares;
}

export function calculateCart(input: {
  lines: readonly PricingLineInput[];
  coupon?: AppliedCouponInput | null;
  currency?: string;
}): CartPricing {
  const currency = input.currency ?? DEFAULT_CURRENCY;
  const coupon = input.coupon ?? null;

  const subtotals = input.lines.map(lineSubtotal);
  const subtotalMinor = sumMinor(subtotals);

  const eligible = input.lines.map((line) => {
    if (!coupon) return false;
    if (coupon.eligibleVariantIds === null) return true;
    return coupon.eligibleVariantIds.includes(line.variantId);
  });

  const eligibleSubtotals = subtotals.map((subtotal, index) => (eligible[index] ? subtotal : 0));
  const eligibleSubtotalMinor = sumMinor(eligibleSubtotals);

  const discountMinor = coupon
    ? capDiscount(
        rawDiscountFor(coupon, eligibleSubtotalMinor),
        eligibleSubtotalMinor,
        coupon.maxDiscountMinor,
      )
    : 0;

  const shares = allocateDiscount(eligibleSubtotals, discountMinor);

  const lines: PricedLine[] = input.lines.map((line, index) => ({
    variantId: line.variantId,
    productId: line.productId,
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
    lineSubtotalMinor: subtotals[index]!,
    lineDiscountMinor: shares[index]!,
    lineTotalMinor: subtotals[index]! - shares[index]!,
    discountEligible: eligible[index]!,
  }));

  // Guaranteed non-negative: `capDiscount` bounds the discount by the
  // eligible subtotal, which is itself a subset of the cart subtotal.
  const totalMinor = subtotalMinor - discountMinor;

  return {
    lines,
    currency,
    subtotalMinor,
    eligibleSubtotalMinor,
    discountMinor,
    totalMinor,
    coupon: coupon
      ? { id: coupon.id, code: coupon.code, type: coupon.type, value: coupon.value }
      : null,
  };
}
