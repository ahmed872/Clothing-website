import { describe, expect, it } from 'vitest';

import { eligibleVariantIdsFor, evaluateCoupon } from './coupon-rules';
import type { CouponEvaluationInput, CouponForEvaluation, CouponScopeRef } from './coupon-rules';
import type { PricingLineInput } from './cart-pricing';

/** Every fact the rules need is passed in, so these run without a database
 * and without waiting for a clock. */

const NOW = new Date('2026-06-15T12:00:00.000Z');

function coupon(overrides: Partial<CouponForEvaluation> = {}): CouponForEvaluation {
  return {
    id: 'c1',
    code: 'WELCOME10',
    type: 'PERCENTAGE',
    value: 10,
    minOrderMinor: null,
    maxDiscountMinor: null,
    usageLimit: null,
    perCustomerLimit: null,
    startsAt: null,
    endsAt: null,
    active: true,
    ...overrides,
  };
}

function line(overrides: Partial<PricingLineInput> = {}): PricingLineInput {
  return {
    variantId: 'v1',
    productId: 'p1',
    categoryId: 'cat1',
    brandId: null,
    quantity: 1,
    unitPriceMinor: 50_000,
    ...overrides,
  };
}

function evaluate(overrides: Partial<CouponEvaluationInput> = {}) {
  return evaluateCoupon({
    coupon: coupon(),
    scopes: [],
    lines: [line()],
    now: NOW,
    totalRedemptions: 0,
    customerRedemptions: 0,
    ...overrides,
  });
}

describe('validity window', () => {
  it('accepts a coupon with no window at all', () => {
    expect(evaluate().ok).toBe(true);
  });

  it('rejects one that has not started', () => {
    const result = evaluate({ coupon: coupon({ startsAt: new Date('2026-07-01') }) });
    expect(result).toMatchObject({ ok: false, reason: 'not_started' });
  });

  it('rejects one that has ended', () => {
    const result = evaluate({ coupon: coupon({ endsAt: new Date('2026-06-01') }) });
    expect(result).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('accepts one inside its window', () => {
    const result = evaluate({
      coupon: coupon({ startsAt: new Date('2026-06-01'), endsAt: new Date('2026-06-30') }),
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an inactive coupon even inside its window', () => {
    const result = evaluate({
      coupon: coupon({
        active: false,
        startsAt: new Date('2026-06-01'),
        endsAt: new Date('2026-06-30'),
      }),
    });
    expect(result).toMatchObject({ ok: false, reason: 'inactive' });
  });
});

describe('usage limits', () => {
  it('rejects once the global limit is reached', () => {
    const result = evaluate({ coupon: coupon({ usageLimit: 5 }), totalRedemptions: 5 });
    expect(result).toMatchObject({ ok: false, reason: 'usage_limit_reached' });
  });

  it('allows the last remaining use', () => {
    const result = evaluate({ coupon: coupon({ usageLimit: 5 }), totalRedemptions: 4 });
    expect(result.ok).toBe(true);
  });

  it('rejects once this customer has used their allowance', () => {
    const result = evaluate({ coupon: coupon({ perCustomerLimit: 1 }), customerRedemptions: 1 });
    expect(result).toMatchObject({ ok: false, reason: 'customer_limit_reached' });
  });

  it('a guest with no history is not blocked by a per-customer limit', () => {
    const result = evaluate({ coupon: coupon({ perCustomerLimit: 1 }), customerRedemptions: 0 });
    expect(result.ok).toBe(true);
  });
});

describe('minimum subtotal', () => {
  it('rejects a cart below the minimum and says what the minimum is', () => {
    const result = evaluate({
      coupon: coupon({ minOrderMinor: 100_000 }),
      lines: [line({ unitPriceMinor: 40_000 })],
    });
    expect(result).toMatchObject({ ok: false, reason: 'below_minimum', minOrderMinor: 100_000 });
  });

  it('accepts a cart exactly at the minimum', () => {
    const result = evaluate({
      coupon: coupon({ minOrderMinor: 100_000 }),
      lines: [line({ unitPriceMinor: 100_000 })],
    });
    expect(result.ok).toBe(true);
  });

  it('measures the minimum against the whole cart, not the scoped part', () => {
    // "Spend 100 to use this code" is a statement about the order. A scoped
    // coupon whose minimum was checked against only its own items would be
    // unusable in a way no admin intends.
    const result = evaluate({
      coupon: coupon({ minOrderMinor: 100_000 }),
      scopes: [{ scopeType: 'PRODUCT', targetId: 'p1' }],
      lines: [
        line({ variantId: 'a', productId: 'p1', unitPriceMinor: 40_000 }),
        line({ variantId: 'b', productId: 'p2', unitPriceMinor: 70_000 }),
      ],
    });
    expect(result.ok).toBe(true);
  });
});

describe('scope', () => {
  const scoped: CouponScopeRef[] = [{ scopeType: 'CATEGORY', targetId: 'shoes' }];

  it('an unscoped coupon covers every line', () => {
    expect(
      eligibleVariantIdsFor([], [line({ variantId: 'a' }), line({ variantId: 'b' })]),
    ).toBeNull();
  });

  it('matches by category', () => {
    const ids = eligibleVariantIdsFor(scoped, [
      line({ variantId: 'a', categoryId: 'shoes' }),
      line({ variantId: 'b', categoryId: 'jackets' }),
    ]);
    expect(ids).toEqual(['a']);
  });

  it('matches by product and by brand, as a union', () => {
    const ids = eligibleVariantIdsFor(
      [
        { scopeType: 'PRODUCT', targetId: 'p9' },
        { scopeType: 'BRAND', targetId: 'b7' },
      ],
      [
        line({ variantId: 'a', productId: 'p9' }),
        line({ variantId: 'b', brandId: 'b7' }),
        line({ variantId: 'c', productId: 'p1', brandId: 'b1' }),
      ],
    );
    expect(ids).toEqual(['a', 'b']);
  });

  it('rejects when the cart contains nothing the coupon covers', () => {
    const result = evaluate({
      scopes: scoped,
      lines: [line({ categoryId: 'jackets' })],
    });
    expect(result).toMatchObject({ ok: false, reason: 'no_eligible_items' });
  });

  it('reports the eligible subtotal, not the cart subtotal', () => {
    const result = evaluate({
      scopes: scoped,
      lines: [
        line({ variantId: 'a', categoryId: 'shoes', unitPriceMinor: 30_000, quantity: 2 }),
        line({ variantId: 'b', categoryId: 'jackets', unitPriceMinor: 90_000 }),
      ],
    });
    expect(result).toMatchObject({ ok: true, eligibleSubtotalMinor: 60_000 });
  });
});

describe('empty cart', () => {
  it('is refused rather than discounting nothing successfully', () => {
    expect(evaluate({ lines: [] })).toMatchObject({ ok: false, reason: 'no_eligible_items' });
  });
});
