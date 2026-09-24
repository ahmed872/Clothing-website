import { describe, expect, it } from 'vitest';

import { parseSearchParams } from './schemas';

describe('parseSearchParams', () => {
  it('parses free text, sort and page', () => {
    const result = parseSearchParams({ q: 'phone', sort: 'price-asc', page: '2' });
    expect(result).toMatchObject({ q: 'phone', sort: 'price-asc', page: 2 });
  });

  it('parses a comma-separated brand list', () => {
    const result = parseSearchParams({ brand: 'bmw,audi' });
    expect(result.brandSlugs).toEqual(['bmw', 'audi']);
  });

  it('parses repeated brand params as an array', () => {
    const result = parseSearchParams({ brand: ['bmw', 'audi'] });
    expect(result.brandSlugs).toEqual(['bmw', 'audi']);
  });

  it('parses attr_ prefixed params into attributeFilters, ignoring unrelated keys', () => {
    const result = parseSearchParams({
      attr_color: 'Black,White',
      attr_fuel_type: 'Hybrid',
      unrelated: 'x',
    });
    expect(result.attributeFilters).toEqual({ color: ['Black', 'White'], fuel_type: ['Hybrid'] });
  });

  it('parses inStock=1 as true and its absence as false', () => {
    expect(parseSearchParams({ inStock: '1' }).inStockOnly).toBe(true);
    expect(parseSearchParams({}).inStockOnly).toBe(false);
  });

  it('parses price bounds as integers', () => {
    const result = parseSearchParams({ priceMin: '1000', priceMax: '5000' });
    expect(result).toMatchObject({ priceMinMinor: 1000, priceMaxMinor: 5000 });
  });

  it('carries overrides through (categorySlug, locale, pageSize)', () => {
    const result = parseSearchParams({}, { categorySlug: 'cars', locale: 'en', pageSize: 12 });
    expect(result).toMatchObject({ categorySlug: 'cars', locale: 'en', pageSize: 12 });
  });

  it('rejects an invalid sort value rather than silently ignoring it', () => {
    expect(() => parseSearchParams({ sort: 'nonsense' })).toThrow();
  });
});
