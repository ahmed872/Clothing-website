import { describe, expect, it } from 'vitest';

import { normalizeWhatsappNumber, whatsappHref } from './whatsapp';

/**
 * The footer shipped `wa.me/0020103033884` to a live store — a link that
 * opens WhatsApp on a number that does not exist, because the digits-only
 * filter it used kept the `00` international *prefix* as if it were part of
 * the number.
 */

describe('normalizeWhatsappNumber', () => {
  it('drops the 00 international prefix — the case that was broken in production', () => {
    expect(normalizeWhatsappNumber('0020103033884')).toBe('20103033884');
  });

  it('drops a + and any punctuation the owner typed', () => {
    expect(normalizeWhatsappNumber('+20 10 303 3884')).toBe('20103033884');
    expect(normalizeWhatsappNumber('+966-50-123-4567')).toBe('966501234567');
    expect(normalizeWhatsappNumber('(966) 50 1234567')).toBe('966501234567');
  });

  it('accepts an already-clean international number unchanged', () => {
    expect(normalizeWhatsappNumber('966501234567')).toBe('966501234567');
  });

  it('refuses a national-format number rather than inventing a country code', () => {
    // A single leading zero is a trunk prefix, not an international number —
    // guessing the country here would produce a plausible, wrong link.
    expect(normalizeWhatsappNumber('01030338840')).toBeNull();
    expect(normalizeWhatsappNumber('0501234567')).toBeNull();
  });

  it('refuses input that is not a phone number at all', () => {
    expect(normalizeWhatsappNumber('')).toBeNull();
    expect(normalizeWhatsappNumber('   ')).toBeNull();
    expect(normalizeWhatsappNumber('abc')).toBeNull();
    expect(normalizeWhatsappNumber('12345')).toBeNull();
    expect(normalizeWhatsappNumber('1'.repeat(20))).toBeNull();
  });
});

describe('whatsappHref', () => {
  it('builds a usable link from the number the store actually stored', () => {
    expect(whatsappHref('0020103033884')).toBe('https://wa.me/20103033884');
  });

  it('is null when there is nothing to link to, so the caller renders text instead', () => {
    expect(whatsappHref(null)).toBeNull();
    expect(whatsappHref(undefined)).toBeNull();
    expect(whatsappHref('')).toBeNull();
    expect(whatsappHref('01030338840')).toBeNull();
  });
});
