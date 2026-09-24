import { MEASUREMENT_BOUNDS, type MeasurementKey } from './options';

/**
 * Turning what a customer typed into a measurement — dependency-free, so the
 * server's validation and the form's live preview read "88,5" the same way.
 *
 * Accepted: Latin digits, Arabic-Indic digits (٠-٩) and Extended/Persian
 * digits (۰-۹), with `.`, `,` or the Arabic decimal separator `٫`, up to
 * three whole digits and two decimals. Stored at one decimal place, rounded
 * half up. Anything else — a sign, an exponent, a second separator, letters,
 * a unit typed into the box — is `'invalid'` rather than guessed at.
 */

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;
const MEASUREMENT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

function toLatinDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - ARABIC_INDIC_ZERO))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - EXTENDED_ARABIC_INDIC_ZERO));
}

/** One decimal place — the storage precision. */
export function roundMeasurement(value: number): number {
  return Math.round(value * 10) / 10;
}

/** `null` when nothing was entered; `'invalid'` when something was, but it
 * is not a plain positive number. */
export function parseMeasurementInput(raw: unknown): number | null | 'invalid' {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? roundMeasurement(raw) : 'invalid';
  }
  if (typeof raw !== 'string') return 'invalid';

  const normalized = toLatinDigits(raw.trim()).replace(/[٫,]/g, '.');
  if (normalized === '') return null;
  if (!MEASUREMENT_PATTERN.test(normalized)) return 'invalid';
  return roundMeasurement(Number(normalized));
}

export type MeasurementProblem = 'invalid_number' | 'too_small' | 'too_large';

/** The one range check, shared by `bodyProfileInputSchema` and the form. */
export function checkMeasurement(
  key: MeasurementKey,
  raw: unknown,
): { value: number | null; problem: MeasurementProblem | null } {
  const parsed = parseMeasurementInput(raw);
  if (parsed === 'invalid') return { value: null, problem: 'invalid_number' };
  if (parsed === null) return { value: null, problem: null };
  const { min, max } = MEASUREMENT_BOUNDS[key];
  if (parsed < min) return { value: null, problem: 'too_small' };
  if (parsed > max) return { value: null, problem: 'too_large' };
  return { value: parsed, problem: null };
}
