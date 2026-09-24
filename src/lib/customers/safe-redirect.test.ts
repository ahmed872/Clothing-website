import { describe, expect, it } from 'vitest';

import { safeAccountRedirect } from './safe-redirect';

/**
 * Open-redirect prevention (P12 §17) — the one function every value a
 * customer could have supplied through `?next=` passes through before it
 * is ever handed to `redirect()`. Every test here is an attack the function
 * must defeat, not a happy-path check: Next's `redirect()` follows an
 * absolute URL exactly as readily as a relative one (confirmed against
 * Next's own docs), so each case below is a real phishing vector if this
 * function ever let it through.
 */

describe('safeAccountRedirect', () => {
  it('falls back to /account for a null or empty value', () => {
    expect(safeAccountRedirect('ar', null)).toBe('/ar/account');
    expect(safeAccountRedirect('ar', undefined)).toBe('/ar/account');
    expect(safeAccountRedirect('ar', '')).toBe('/ar/account');
  });

  it('allows a same-locale path under /account', () => {
    expect(safeAccountRedirect('ar', '/ar/account/orders')).toBe('/ar/account/orders');
  });

  it('allows the bare locale-scoped path itself', () => {
    expect(safeAccountRedirect('ar', '/ar')).toBe('/ar');
  });

  it('allows a same-locale storefront path outside /account (e.g. checkout)', () => {
    expect(safeAccountRedirect('ar', '/ar/checkout')).toBe('/ar/checkout');
  });

  it('preserves a query string on an otherwise-safe path', () => {
    expect(safeAccountRedirect('ar', '/ar/account/orders?page=2')).toBe(
      '/ar/account/orders?page=2',
    );
  });

  it('rejects an absolute URL to an external host', () => {
    expect(safeAccountRedirect('ar', 'https://evil.example/phish')).toBe('/ar/account');
  });

  it('rejects a protocol-relative URL — a browser reads // as same-scheme, different host', () => {
    expect(safeAccountRedirect('ar', '//evil.example')).toBe('/ar/account');
    expect(safeAccountRedirect('ar', '//evil.example/ar/account')).toBe('/ar/account');
  });

  it('rejects a path prefixed with the wrong locale', () => {
    expect(safeAccountRedirect('ar', '/en/account')).toBe('/ar/account');
  });

  it('rejects a path with no locale prefix at all, including /admin', () => {
    expect(safeAccountRedirect('ar', '/admin')).toBe('/ar/account');
    expect(safeAccountRedirect('ar', '/admin/orders')).toBe('/ar/account');
  });

  it('rejects a bare-domain-looking value with no leading slash', () => {
    expect(safeAccountRedirect('ar', 'evil.example')).toBe('/ar/account');
  });

  it('rejects a javascript: pseudo-URL', () => {
    expect(safeAccountRedirect('ar', 'javascript:alert(1)')).toBe('/ar/account');
  });

  it('rejects a backslash trick some browsers normalize to a host change', () => {
    expect(safeAccountRedirect('ar', '/\\evil.example')).toBe('/ar/account');
  });

  it('rejects a value that is only a partial prefix match (not a real path boundary)', () => {
    // `/ar-fake/...` starts with "/ar" but not with "/ar/" — must not pass.
    expect(safeAccountRedirect('ar', '/ar-fake/account')).toBe('/ar/account');
  });

  it('works the same way for the other supported locale', () => {
    expect(safeAccountRedirect('en', '/en/account/profile')).toBe('/en/account/profile');
    expect(safeAccountRedirect('en', '/ar/account')).toBe('/en/account');
    expect(safeAccountRedirect('en', 'https://evil.example')).toBe('/en/account');
  });
});
