import { describe, expect, it } from 'vitest';

import { directionForLocale, isLocale, localizeHref, localizePath } from './locales';

describe('isLocale', () => {
  it('accepts ar and en', () => {
    expect(isLocale('ar')).toBe(true);
    expect(isLocale('en')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('')).toBe(false);
  });
});

describe('directionForLocale', () => {
  it('is rtl for ar and ltr for en', () => {
    expect(directionForLocale('ar')).toBe('rtl');
    expect(directionForLocale('en')).toBe('ltr');
  });
});

describe('localizePath', () => {
  it('swaps an existing locale prefix', () => {
    expect(localizePath('/ar/c/cars', 'en')).toBe('/en/c/cars');
  });

  it('prefixes a path with no locale segment at all', () => {
    expect(localizePath('/c/cars', 'ar')).toBe('/ar/c/cars');
  });

  it('handles the bare locale root', () => {
    expect(localizePath('/ar', 'en')).toBe('/en');
  });

  it('handles the site root', () => {
    expect(localizePath('/', 'en')).toBe('/en');
  });
});

describe('localizeHref', () => {
  it('localizes an internal path', () => {
    expect(localizeHref('/c/cars', 'ar')).toBe('/ar/c/cars');
  });

  it('leaves an absolute external URL untouched', () => {
    expect(localizeHref('https://example.com/promo', 'ar')).toBe('https://example.com/promo');
  });

  it('leaves a same-page anchor untouched', () => {
    expect(localizeHref('#details', 'en')).toBe('#details');
  });
});
