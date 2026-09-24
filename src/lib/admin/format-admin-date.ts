import type { Locale } from '@/lib/i18n/locales';

/** LEFT-TO-RIGHT MARK and RIGHT-TO-LEFT MARK. */
const DIRECTION_MARKS = /[‎‏]/g;

/**
 * A short date for an admin table, in the reader's locale.
 *
 * Built from `formatToParts` rather than `format` because the Arabic format
 * inserts RIGHT-TO-LEFT MARKs between the parts (`01‏/09‏/2026`).
 * Those are strong-direction characters: in a table cell they reorder the
 * run into `012026/09/`, which is not a date anyone can read. Joining the
 * parts without them yields the same date and lets the cell render it as
 * one left-to-right run — the same reasoning ADR-023 already applies to
 * digits, which are forced to Latin in both locales so numbers read
 * identically.
 */
export function formatAdminDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: 'medium' })
    .formatToParts(date)
    .map((part) => part.value.replace(DIRECTION_MARKS, ''))
    .join('');
}
