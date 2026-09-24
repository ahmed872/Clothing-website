import { z } from 'zod';

import type { SearchQuery } from './provider';

/**
 * URL search params are always strings (or string arrays) — this is the one
 * place that raw shape gets turned into a typed `SearchQuery`. Every
 * storefront listing/search page shares it, so `?sort=price-asc` means the
 * same thing on `/c/[slug]` and `/search`.
 *
 * Attribute filters don't have fixed keys (a category defines its own), so
 * they use a `attr_<key>=value1,value2` convention rather than a fixed
 * schema field — anything not matching that prefix is ignored, not an error.
 */

const sortSchema = z.enum(['relevance', 'newest', 'price-asc', 'price-desc', 'featured']);

const knownParamsSchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  brand: z.union([z.string(), z.array(z.string())]).optional(),
  priceMin: z.coerce.number().int().nonnegative().optional(),
  priceMax: z.coerce.number().int().nonnegative().optional(),
  inStock: z.literal('1').optional(),
  sort: sortSchema.optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const ATTRIBUTE_PARAM_PREFIX = 'attr_';

export function parseSearchParams(
  raw: RawSearchParams,
  overrides: Pick<SearchQuery, 'categorySlug' | 'locale' | 'pageSize'> = {},
): SearchQuery {
  // Only `brand` is allowed to arrive as a repeated param (`?brand=a&brand=b`)
  // — every other known param collapses to its first occurrence.
  const flat: Record<string, string | string[] | undefined> = { brand: raw.brand };
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'brand') continue;
    flat[key] = firstValue(value);
  }
  const parsed = knownParamsSchema.parse(flat);

  const attributeFilters: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith(ATTRIBUTE_PARAM_PREFIX) || value === undefined) continue;
    const attrKey = key.slice(ATTRIBUTE_PARAM_PREFIX.length);
    const values = (Array.isArray(value) ? value : value.split(','))
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.length > 0) attributeFilters[attrKey] = values;
  }

  const brandSlugs = parsed.brand
    ? (Array.isArray(parsed.brand) ? parsed.brand : parsed.brand.split(','))
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  return {
    q: parsed.q,
    categorySlug: overrides.categorySlug,
    brandSlugs,
    attributeFilters: Object.keys(attributeFilters).length > 0 ? attributeFilters : undefined,
    priceMinMinor: parsed.priceMin,
    priceMaxMinor: parsed.priceMax,
    inStockOnly: parsed.inStock === '1',
    sort: parsed.sort,
    page: parsed.page,
    pageSize: overrides.pageSize,
    locale: overrides.locale,
  };
}
