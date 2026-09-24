import { describe, expect, it } from 'vitest';

import { resolveEffectivePrice, resolveListingPrice } from './variant-pricing';

function variant(overrides: Partial<Parameters<typeof resolveEffectivePrice>[0]> = {}) {
  return {
    priceMinor: 10_000,
    compareAtMinor: null,
    salePriceMinor: null,
    saleStartsAt: null,
    saleEndsAt: null,
    ...overrides,
  };
}

describe('resolveEffectivePrice', () => {
  it('returns the regular price with no compare-at when nothing else is set', () => {
    expect(resolveEffectivePrice(variant())).toEqual({
      currentMinor: 10_000,
      compareAtMinor: null,
      onSale: false,
    });
  });

  it('shows compareAtMinor struck-through when it is higher than the regular price', () => {
    expect(resolveEffectivePrice(variant({ compareAtMinor: 15_000 }))).toEqual({
      currentMinor: 10_000,
      compareAtMinor: 15_000,
      onSale: false,
    });
  });

  it('ignores a compareAtMinor that is not actually higher (nothing to compare)', () => {
    expect(resolveEffectivePrice(variant({ compareAtMinor: 8_000 }))).toEqual({
      currentMinor: 10_000,
      compareAtMinor: null,
      onSale: false,
    });
  });

  it('uses the sale price when no window is set (always active)', () => {
    expect(resolveEffectivePrice(variant({ salePriceMinor: 7_500 }))).toEqual({
      currentMinor: 7_500,
      compareAtMinor: 10_000,
      onSale: true,
    });
  });

  it('uses the sale price inside an open window', () => {
    const now = new Date('2026-06-15T00:00:00Z');
    const result = resolveEffectivePrice(
      variant({
        salePriceMinor: 7_500,
        saleStartsAt: new Date('2026-06-01T00:00:00Z'),
        saleEndsAt: new Date('2026-06-30T00:00:00Z'),
      }),
      now,
    );
    expect(result).toEqual({ currentMinor: 7_500, compareAtMinor: 10_000, onSale: true });
  });

  it('ignores a sale price before its start date', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const result = resolveEffectivePrice(
      variant({ salePriceMinor: 7_500, saleStartsAt: new Date('2026-06-01T00:00:00Z') }),
      now,
    );
    expect(result).toEqual({ currentMinor: 10_000, compareAtMinor: null, onSale: false });
  });

  it('ignores a sale price after its end date', () => {
    const now = new Date('2026-12-01T00:00:00Z');
    const result = resolveEffectivePrice(
      variant({ salePriceMinor: 7_500, saleEndsAt: new Date('2026-06-30T00:00:00Z') }),
      now,
    );
    expect(result).toEqual({ currentMinor: 10_000, compareAtMinor: null, onSale: false });
  });

  it('compares the sale price against an explicit compareAtMinor when it is higher than the regular price', () => {
    const result = resolveEffectivePrice(
      variant({ salePriceMinor: 7_500, compareAtMinor: 20_000 }),
    );
    expect(result).toEqual({ currentMinor: 7_500, compareAtMinor: 20_000, onSale: true });
  });

  it('never leaves a fractional halala or touches floating point', () => {
    const result = resolveEffectivePrice(variant({ priceMinor: 999_999 }));
    expect(Number.isInteger(result.currentMinor)).toBe(true);
  });
});

describe('resolveListingPrice', () => {
  it('picks the lowest current price across variants ("From SAR X")', () => {
    const result = resolveListingPrice([
      variant({ priceMinor: 30_000 }),
      variant({ priceMinor: 20_000 }),
    ]);
    expect(result.currentMinor).toBe(20_000);
  });

  it('accounts for an active sale when comparing across variants', () => {
    const result = resolveListingPrice([
      variant({ priceMinor: 20_000 }),
      variant({ priceMinor: 30_000, salePriceMinor: 15_000 }),
    ]);
    expect(result.currentMinor).toBe(15_000);
    expect(result.onSale).toBe(true);
  });

  it('throws for an empty variant list rather than returning a fake price', () => {
    expect(() => resolveListingPrice([])).toThrow();
  });
});
