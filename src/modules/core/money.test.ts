import { describe, expect, it } from 'vitest';

import { applyPercentage, assertMinor, formatMoney, fromMinor, sumMinor, toMinor } from './money';

describe('minor unit conversion', () => {
  it('converts major units to integer minor units', () => {
    expect(toMinor(125)).toBe(12500);
    expect(toMinor(0.1)).toBe(10);
    expect(toMinor(0)).toBe(0);
  });

  it('rounds instead of truncating, so no halala is silently lost', () => {
    expect(toMinor(19.999)).toBe(2000);
    expect(toMinor(0.005)).toBe(1);
  });

  it('survives the float artefacts that break naive multiplication', () => {
    // 1.15 * 100 is 114.99999999999999 in IEEE 754.
    expect(toMinor(1.15)).toBe(115);
    expect(toMinor(8.7)).toBe(870);
  });

  it('round-trips', () => {
    expect(fromMinor(toMinor(1234.56))).toBe(1234.56);
  });

  it('rejects non-finite input', () => {
    expect(() => toMinor(Number.NaN)).toThrow(/non-finite/);
    expect(() => toMinor(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
  });
});

describe('assertMinor', () => {
  it('accepts integers', () => {
    expect(() => assertMinor(0)).not.toThrow();
    expect(() => assertMinor(-500)).not.toThrow();
  });

  it('rejects fractional amounts, which are always a bug in stored money', () => {
    expect(() => assertMinor(12.5)).toThrow(/integer minor units/);
  });

  it('rejects amounts beyond safe integer precision', () => {
    expect(() => assertMinor(Number.MAX_SAFE_INTEGER + 2)).toThrow();
  });
});

describe('sumMinor', () => {
  it('sums without floating point drift', () => {
    expect(sumMinor([10, 20, 30])).toBe(60);
    expect(sumMinor([])).toBe(0);
  });

  it('refuses to sum a fractional amount', () => {
    expect(() => sumMinor([100, 0.5])).toThrow();
  });
});

describe('applyPercentage', () => {
  it('computes a discount in whole minor units', () => {
    expect(applyPercentage(10000, 10)).toBe(1000);
    expect(applyPercentage(10000, 0)).toBe(0);
    expect(applyPercentage(10000, 100)).toBe(10000);
  });

  it('rounds a fractional result rather than leaving a partial halala', () => {
    expect(applyPercentage(101, 33)).toBe(33);
  });

  it('rejects percentages outside 0-100', () => {
    expect(() => applyPercentage(100, -1)).toThrow(/between 0 and 100/);
    expect(() => applyPercentage(100, 101)).toThrow(/between 0 and 100/);
  });
});

describe('formatMoney', () => {
  it('formats SAR by default', () => {
    const formatted = formatMoney(12500);
    expect(formatted).toContain('125');
  });

  it('uses Latin digits in Arabic, so prices read identically in both languages', () => {
    const arabic = formatMoney(12500, { locale: 'ar' });
    const english = formatMoney(12500, { locale: 'en' });

    // No Eastern Arabic numerals anywhere.
    expect(arabic).not.toMatch(/[٠-٩]/);
    expect(arabic).toMatch(/125/);
    expect(english).toMatch(/125/);
  });

  it('always shows both minor digits', () => {
    expect(formatMoney(12500, { locale: 'en' })).toMatch(/125\.00/);
    expect(formatMoney(12599, { locale: 'en' })).toMatch(/125\.99/);
  });

  it('supports another currency without code changes', () => {
    expect(formatMoney(12500, { currency: 'USD', locale: 'en' })).toMatch(/125\.00/);
  });

  it('refuses to format a fractional amount', () => {
    expect(() => formatMoney(125.5)).toThrow();
  });
});
