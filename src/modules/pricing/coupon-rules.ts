import type { CouponKind, PricingLineInput } from './cart-pricing';

/**
 * Whether a coupon may be applied to this cart, right now, by this customer
 * (P09 §8/§9). Pure, like the calculator: every fact it needs — the clock,
 * the redemption counts — is passed in, so the same situation always
 * produces the same verdict and the rules are testable without a database.
 *
 * The reasons below are internal. `coupon-messages.ts` decides what a
 * customer is actually told, which is deliberately less specific in the
 * cases where precision would leak how the promotion is configured.
 */

export type CouponRejection =
  | 'not_found'
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'usage_limit_reached'
  | 'customer_limit_reached'
  | 'below_minimum'
  | 'no_eligible_items';

export interface CouponForEvaluation {
  id: string;
  code: string;
  type: CouponKind;
  value: number;
  minOrderMinor: number | null;
  maxDiscountMinor: number | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
}

export type CouponScopeKind = 'PRODUCT' | 'CATEGORY' | 'BRAND';

export interface CouponScopeRef {
  scopeType: CouponScopeKind;
  targetId: string;
}

export interface CouponEvaluationInput {
  coupon: CouponForEvaluation;
  /** No rows means the coupon applies to the whole cart. */
  scopes: readonly CouponScopeRef[];
  lines: readonly PricingLineInput[];
  now: Date;
  /** How many times this coupon has been redeemed in total. */
  totalRedemptions: number;
  /** How many times *this* customer has redeemed it. Guests have no history. */
  customerRedemptions: number;
}

export type CouponEvaluation =
  | { ok: true; eligibleVariantIds: string[] | null; eligibleSubtotalMinor: number }
  | { ok: false; reason: CouponRejection; minOrderMinor?: number };

/** Which of the cart's lines this coupon is allowed to discount. `null`
 * means every line, which is what an unscoped coupon returns — distinct
 * from an empty array, which means "scoped, and nothing here matches". */
export function eligibleVariantIdsFor(
  scopes: readonly CouponScopeRef[],
  lines: readonly PricingLineInput[],
): string[] | null {
  if (scopes.length === 0) return null;

  const products = new Set(scopes.filter((s) => s.scopeType === 'PRODUCT').map((s) => s.targetId));
  const categories = new Set(
    scopes.filter((s) => s.scopeType === 'CATEGORY').map((s) => s.targetId),
  );
  const brands = new Set(scopes.filter((s) => s.scopeType === 'BRAND').map((s) => s.targetId));

  // Scopes are a union, not an intersection: a coupon scoped to "the Shoes
  // category and the Runner product" covers both, which is what an admin
  // selecting several things expects.
  return lines
    .filter(
      (line) =>
        products.has(line.productId) ||
        categories.has(line.categoryId) ||
        (line.brandId !== null && brands.has(line.brandId)),
    )
    .map((line) => line.variantId);
}

export function evaluateCoupon(input: CouponEvaluationInput): CouponEvaluation {
  const { coupon, lines, now } = input;

  if (!coupon.active) return { ok: false, reason: 'inactive' };
  if (coupon.startsAt && now < coupon.startsAt) return { ok: false, reason: 'not_started' };
  if (coupon.endsAt && now > coupon.endsAt) return { ok: false, reason: 'expired' };

  if (coupon.usageLimit !== null && input.totalRedemptions >= coupon.usageLimit) {
    return { ok: false, reason: 'usage_limit_reached' };
  }
  if (coupon.perCustomerLimit !== null && input.customerRedemptions >= coupon.perCustomerLimit) {
    return { ok: false, reason: 'customer_limit_reached' };
  }

  const eligibleVariantIds = eligibleVariantIdsFor(input.scopes, lines);
  const covers = (variantId: string): boolean =>
    eligibleVariantIds === null || eligibleVariantIds.includes(variantId);

  const eligibleSubtotalMinor = lines
    .filter((line) => covers(line.variantId))
    .reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);

  if (eligibleSubtotalMinor <= 0) return { ok: false, reason: 'no_eligible_items' };

  // The minimum is checked against the *whole* cart, not the eligible part:
  // "spend 100 to use this code" is a statement about the order, and
  // checking it against the scoped subset would make a scoped coupon
  // unusable in a way no admin intends.
  const cartSubtotalMinor = lines.reduce(
    (sum, line) => sum + line.unitPriceMinor * line.quantity,
    0,
  );
  if (coupon.minOrderMinor !== null && cartSubtotalMinor < coupon.minOrderMinor) {
    return { ok: false, reason: 'below_minimum', minOrderMinor: coupon.minOrderMinor };
  }

  return { ok: true, eligibleVariantIds, eligibleSubtotalMinor };
}
