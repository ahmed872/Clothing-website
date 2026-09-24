import { describe, expect, it } from 'vitest';

import { allocateDiscount, calculateCart, capDiscount, rawDiscountFor } from './cart-pricing';
import type { AppliedCouponInput, PricingLineInput } from './cart-pricing';

/**
 * The money boundary (P09 §11). Every amount here is in halalas, and the
 * cases are the ones where a naive implementation goes wrong: odd amounts
 * that do not divide evenly, a discount larger than the cart, 0% and 100%,
 * and allocations whose parts must add back up to the whole.
 */

function line(overrides: Partial<PricingLineInput> = {}): PricingLineInput {
  return {
    variantId: 'v1',
    productId: 'p1',
    categoryId: 'c1',
    brandId: null,
    quantity: 1,
    unitPriceMinor: 10_000,
    ...overrides,
  };
}

function coupon(overrides: Partial<AppliedCouponInput> = {}): AppliedCouponInput {
  return {
    id: 'coupon-1',
    code: 'TEST',
    type: 'PERCENTAGE',
    value: 10,
    maxDiscountMinor: null,
    eligibleVariantIds: null,
    ...overrides,
  };
}

describe('calculateCart — without a coupon', () => {
  it('multiplies and sums in integer minor units', () => {
    const result = calculateCart({
      lines: [
        line({ variantId: 'a', unitPriceMinor: 45_000, quantity: 2 }),
        line({ variantId: 'b', unitPriceMinor: 12_550, quantity: 3 }),
      ],
    });

    expect(result.subtotalMinor).toBe(45_000 * 2 + 12_550 * 3);
    expect(result.discountMinor).toBe(0);
    expect(result.totalMinor).toBe(result.subtotalMinor);
    expect(result.lines[0]!.lineSubtotalMinor).toBe(90_000);
    expect(result.lines[1]!.lineTotalMinor).toBe(37_650);
  });

  it('an empty cart is zero, not an error', () => {
    const result = calculateCart({ lines: [] });
    expect(result.subtotalMinor).toBe(0);
    expect(result.totalMinor).toBe(0);
    expect(result.discountMinor).toBe(0);
  });

  it('refuses a fractional amount rather than silently rounding it', () => {
    expect(() => calculateCart({ lines: [line({ unitPriceMinor: 10.5 })] })).toThrow();
  });

  it('refuses a negative quantity', () => {
    expect(() => calculateCart({ lines: [line({ quantity: -1 })] })).toThrow();
  });
});

describe('percentage discounts', () => {
  it('10% of an odd amount rounds to a whole halala', () => {
    // 1005 halalas → 100.5 → 101, half away from zero. Never 100.5 stored.
    const result = calculateCart({ lines: [line({ unitPriceMinor: 1005 })], coupon: coupon() });
    expect(result.discountMinor).toBe(101);
    expect(result.totalMinor).toBe(904);
    expect(Number.isInteger(result.totalMinor)).toBe(true);
  });

  it('0% discounts nothing', () => {
    const result = calculateCart({
      lines: [line({ unitPriceMinor: 9_999 })],
      coupon: coupon({ value: 0 }),
    });
    expect(result.discountMinor).toBe(0);
    expect(result.totalMinor).toBe(9_999);
  });

  it('100% brings the total to exactly zero, never below', () => {
    const result = calculateCart({
      lines: [line({ unitPriceMinor: 7_777 })],
      coupon: coupon({ value: 100 }),
    });
    expect(result.discountMinor).toBe(7_777);
    expect(result.totalMinor).toBe(0);
  });

  it('rejects a percentage above 100 rather than producing a negative total', () => {
    expect(() => calculateCart({ lines: [line()], coupon: coupon({ value: 150 }) })).toThrow();
  });

  it('honours a maximum discount ceiling', () => {
    // 20% of 500.00 would be 100.00, but the coupon caps at 30.00.
    const result = calculateCart({
      lines: [line({ unitPriceMinor: 50_000 })],
      coupon: coupon({ value: 20, maxDiscountMinor: 3_000 }),
    });
    expect(result.discountMinor).toBe(3_000);
    expect(result.totalMinor).toBe(47_000);
  });

  it('handles the smallest possible amount', () => {
    // 1 halala, 10% → 0.1 → 0. A discount that rounds away is still a
    // valid, non-negative result.
    const result = calculateCart({ lines: [line({ unitPriceMinor: 1 })], coupon: coupon() });
    expect(result.discountMinor).toBe(0);
    expect(result.totalMinor).toBe(1);
  });

  it('handles a large cart without losing integer precision', () => {
    const result = calculateCart({
      lines: [line({ unitPriceMinor: 900_000_000, quantity: 5 })],
      coupon: coupon({ value: 33 }),
    });
    expect(Number.isSafeInteger(result.totalMinor)).toBe(true);
    expect(result.discountMinor).toBe(Math.round((4_500_000_000 * 33) / 100));
    expect(result.totalMinor).toBe(4_500_000_000 - result.discountMinor);
  });
});

describe('fixed discounts', () => {
  it('subtracts a fixed amount', () => {
    const result = calculateCart({
      lines: [line({ unitPriceMinor: 30_000 })],
      coupon: coupon({ type: 'FIXED', value: 5_000 }),
    });
    expect(result.discountMinor).toBe(5_000);
    expect(result.totalMinor).toBe(25_000);
  });

  it('a fixed discount equal to the subtotal lands on exactly zero', () => {
    const result = calculateCart({
      lines: [line({ unitPriceMinor: 5_000 })],
      coupon: coupon({ type: 'FIXED', value: 5_000 }),
    });
    expect(result.totalMinor).toBe(0);
  });

  it('a fixed discount larger than the subtotal is capped, never negative', () => {
    const result = calculateCart({
      lines: [line({ unitPriceMinor: 2_000 })],
      coupon: coupon({ type: 'FIXED', value: 500_000 }),
    });
    expect(result.discountMinor).toBe(2_000);
    expect(result.totalMinor).toBe(0);
  });
});

describe('scoped discounts', () => {
  it('discounts only the lines the coupon covers', () => {
    const result = calculateCart({
      lines: [
        line({ variantId: 'shoe', unitPriceMinor: 40_000 }),
        line({ variantId: 'jacket', unitPriceMinor: 60_000 }),
      ],
      coupon: coupon({ value: 50, eligibleVariantIds: ['shoe'] }),
    });

    expect(result.subtotalMinor).toBe(100_000);
    expect(result.eligibleSubtotalMinor).toBe(40_000);
    expect(result.discountMinor).toBe(20_000);
    expect(result.totalMinor).toBe(80_000);

    expect(result.lines[0]!.lineDiscountMinor).toBe(20_000);
    expect(result.lines[1]!.lineDiscountMinor).toBe(0);
    expect(result.lines[1]!.discountEligible).toBe(false);
  });

  it('a fixed discount cannot spill past the scoped subtotal onto other lines', () => {
    const result = calculateCart({
      lines: [
        line({ variantId: 'shoe', unitPriceMinor: 3_000 }),
        line({ variantId: 'jacket', unitPriceMinor: 90_000 }),
      ],
      coupon: coupon({ type: 'FIXED', value: 50_000, eligibleVariantIds: ['shoe'] }),
    });
    expect(result.discountMinor).toBe(3_000);
    expect(result.totalMinor).toBe(90_000);
  });
});

describe('allocateDiscount', () => {
  it('splits proportionally and the parts sum exactly to the whole', () => {
    // 100 across 3 lines cannot divide evenly; the leftovers must land
    // somewhere rather than vanishing from the line totals.
    const shares = allocateDiscount([1_000, 1_000, 1_000], 100);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    expect(shares).toEqual([34, 33, 33]);
  });

  it('gives an ineligible line nothing', () => {
    const shares = allocateDiscount([0, 5_000], 500);
    expect(shares).toEqual([0, 500]);
  });

  it('is deterministic for ties', () => {
    const a = allocateDiscount([700, 700, 700, 700], 10);
    const b = allocateDiscount([700, 700, 700, 700], 10);
    expect(a).toEqual(b);
    expect(a.reduce((x, y) => x + y, 0)).toBe(10);
  });

  it('allocates nothing when there is nothing to allocate', () => {
    expect(allocateDiscount([1_000, 2_000], 0)).toEqual([0, 0]);
    expect(allocateDiscount([0, 0], 500)).toEqual([0, 0]);
  });

  it('line discounts always sum to the cart discount', () => {
    const result = calculateCart({
      lines: [
        line({ variantId: 'a', unitPriceMinor: 3_333 }),
        line({ variantId: 'b', unitPriceMinor: 6_667 }),
        line({ variantId: 'c', unitPriceMinor: 1, quantity: 7 }),
      ],
      coupon: coupon({ value: 17 }),
    });
    const summed = result.lines.reduce((sum, l) => sum + l.lineDiscountMinor, 0);
    expect(summed).toBe(result.discountMinor);
    const totals = result.lines.reduce((sum, l) => sum + l.lineTotalMinor, 0);
    expect(totals).toBe(result.totalMinor);
  });
});

describe('helpers', () => {
  it('capDiscount is bounded below by zero and above by the eligible subtotal', () => {
    expect(capDiscount(-50, 1_000, null)).toBe(0);
    expect(capDiscount(5_000, 1_000, null)).toBe(1_000);
    expect(capDiscount(900, 1_000, 500)).toBe(500);
  });

  it('rawDiscountFor reads the coupon type', () => {
    expect(rawDiscountFor({ type: 'FIXED', value: 250 }, 10_000)).toBe(250);
    expect(rawDiscountFor({ type: 'PERCENTAGE', value: 25 }, 10_000)).toBe(2_500);
  });
});

describe('determinism', () => {
  it('the same cart and coupon always produce the same numbers', () => {
    const lines = [
      line({ variantId: 'a', unitPriceMinor: 12_345, quantity: 3 }),
      line({ variantId: 'b', unitPriceMinor: 6_789, quantity: 2 }),
    ];
    const promo = coupon({ value: 13 });
    const first = calculateCart({ lines, coupon: promo });
    const second = calculateCart({ lines: [...lines].reverse(), coupon: promo });

    expect(first.subtotalMinor).toBe(second.subtotalMinor);
    expect(first.discountMinor).toBe(second.discountMinor);
    expect(first.totalMinor).toBe(second.totalMinor);
  });
});
