/**
 * Money handling.
 *
 * Every monetary value in this platform is an integer in the currency's minor
 * unit (halalas for SAR, cents for USD) — see ADR-006 and ADR-022. Floating
 * point never touches a stored amount, because rounding drift in order totals
 * is not acceptable in a financial system.
 *
 * The field naming is `...Minor` rather than `...Cents` so the model stays
 * correct for any store currency, since the currency itself is configurable
 * (ADR-015).
 */

export const DEFAULT_CURRENCY = 'SAR';
export const DEFAULT_MINOR_UNIT_EXPONENT = 2;

export type Locale = 'ar' | 'en';

/** Convert a major-unit amount (12.34) to minor units (1234). */
export function toMinor(major: number, exponent: number = DEFAULT_MINOR_UNIT_EXPONENT): number {
  if (!Number.isFinite(major)) {
    throw new Error(`Cannot convert a non-finite amount to minor units: ${major}`);
  }
  return Math.round(major * 10 ** exponent);
}

/** Convert minor units (1234) back to a major-unit number (12.34). */
export function fromMinor(minor: number, exponent: number = DEFAULT_MINOR_UNIT_EXPONENT): number {
  assertMinor(minor);
  return minor / 10 ** exponent;
}

/** Minor-unit amounts must always be safe integers. */
export function assertMinor(minor: number): void {
  if (!Number.isInteger(minor)) {
    throw new Error(`Monetary amounts must be integer minor units, received: ${minor}`);
  }
  if (!Number.isSafeInteger(minor)) {
    throw new Error(`Monetary amount is outside the safe integer range: ${minor}`);
  }
}

/**
 * Format a minor-unit amount for display.
 *
 * Latin digits are forced in both locales (ADR-023): prices, SKUs and order
 * numbers must read identically in Arabic and English, and browsers otherwise
 * disagree on whether `ar` implies Eastern Arabic numerals.
 */
export function formatMoney(
  minor: number,
  options: { currency?: string; locale?: Locale; exponent?: number } = {},
): string {
  const {
    currency = DEFAULT_CURRENCY,
    locale = 'ar',
    exponent = DEFAULT_MINOR_UNIT_EXPONENT,
  } = options;
  assertMinor(minor);

  return new Intl.NumberFormat(`${locale}-u-nu-latn`, {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(fromMinor(minor, exponent));
}

/** Sum minor-unit amounts without ever leaving integer arithmetic. */
export function sumMinor(amounts: readonly number[]): number {
  return amounts.reduce<number>((total, amount) => {
    assertMinor(amount);
    return total + amount;
  }, 0);
}

/**
 * Apply a percentage discount to a minor-unit amount.
 * Rounds half away from zero so a 33% discount never leaves a fractional halala.
 */
export function applyPercentage(minor: number, percentage: number): number {
  assertMinor(minor);
  if (percentage < 0 || percentage > 100) {
    throw new Error(`Percentage must be between 0 and 100, received: ${percentage}`);
  }
  return Math.round((minor * percentage) / 100);
}
