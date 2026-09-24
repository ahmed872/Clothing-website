/**
 * `pricing` — price resolution, discounts, coupons. The only source of monetary totals.
 *
 * May depend on: core, catalog
 * Must not depend on: cart, orders — they call pricing, never the reverse
 *
 * P09 implementation. The split inside this module matters:
 *
 *   `cart-pricing.ts`  — pure: lines in, totals out. No database, no clock.
 *   `coupon-rules.ts`  — pure: is this coupon usable, given these facts.
 *   `coupon.service.ts`— the part that reads and writes rows.
 *
 * Keeping the arithmetic pure is what makes a total reproducible, which is
 * the property `orders` and `payments` will depend on: the same cart and the
 * same promotion always produce the same number, and that number can be
 * re-derived later from stored inputs rather than trusted from a snapshot.
 *
 * Stacking policy (P09 §10): **one coupon code per cart.** Catalog-level
 * promotions — a variant's sale price and its window — are a separate,
 * earlier layer owned by `catalog`'s `resolveEffectivePrice`, and they have
 * already been applied by the time a line reaches this module. So the order
 * is fixed and total: sale price first, then at most one coupon on the
 * resulting subtotal. Two codes never combine, so there is no order-dependent
 * result to reason about and no double discount to exploit.
 *
 * Other modules import `@/modules/pricing`, never a file inside it.
 */

export {
  calculateCart,
  allocateDiscount,
  capDiscount,
  rawDiscountFor,
  type CartPricing,
  type PricedLine,
  type PricingLineInput,
  type AppliedCouponInput,
  type CouponKind,
} from './cart-pricing';

export {
  evaluateCoupon,
  eligibleVariantIdsFor,
  type CouponEvaluation,
  type CouponEvaluationInput,
  type CouponForEvaluation,
  type CouponRejection,
  type CouponScopeKind,
  type CouponScopeRef,
} from './coupon-rules';

export {
  couponInputSchema,
  couponUpdateSchema,
  couponCodeSchema,
  couponScopeInputSchema,
  normalizeCouponCode,
  type CouponInput,
  type CouponScopeInput,
} from './coupon-schemas';

export {
  getCoupon,
  getCouponByCode,
  evaluateCouponForCart,
  countRedemptions,
  consumeCouponUsage,
  consumeCouponUsageWithin,
  createCoupon,
  updateCoupon,
  setCouponActive,
  deleteCoupon,
  listCoupons,
  type CouponWithScopes,
  type CouponListingQuery,
  type CouponListingItem,
  type CouponListingResult,
  type CouponSort,
  type CouponStatusFilter,
} from './coupon.service';
