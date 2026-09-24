import type { ProductListingItem, FilterableAttribute } from '@/modules/catalog';

/**
 * The contract every storefront listing/search surface renders against.
 * `SearchResultItem` is deliberately an alias of `catalog`'s
 * `ProductListingItem` rather than a hand-duplicated shape — today's one
 * real implementation *is* a thin wrapper over `catalog.listProducts` — but
 * nothing outside this module ever imports that type from `@/modules/catalog`
 * directly; every storefront page imports it from `@/modules/search`. That's
 * what makes swapping the implementation (Postgres → Meilisearch/Typesense/
 * Algolia) a one-file change: replace what `getSearchProvider()` returns,
 * keep this contract, and no page component notices.
 */
export type SearchResultItem = ProductListingItem;

export type SearchSort = 'relevance' | 'newest' | 'price-asc' | 'price-desc' | 'featured';

export interface SearchQuery {
  /** Free-text query. Absent/empty means "browse", not "search" — a
   * category or listing page with no typed query still goes through this
   * same contract. */
  q?: string;
  categorySlug?: string;
  brandSlugs?: string[];
  /** Only keys a category's `filterable` AttributeDefinition rows expose —
   * see `facets.attributes` in the result. */
  attributeFilters?: Record<string, string[]>;
  priceMinMinor?: number;
  priceMaxMinor?: number;
  inStockOnly?: boolean;
  sort?: SearchSort;
  page?: number;
  pageSize?: number;
  locale?: 'ar' | 'en';
}

export interface SearchFacets {
  brands: { id: string; slug: string; nameAr: string; nameEn: string }[];
  /** Only populated when `categorySlug` resolved to a real category — a
   * cross-category search has no single attribute set to offer filters for. */
  attributes: FilterableAttribute[];
  priceRange: { minMinor: number; maxMinor: number } | null;
}

export interface SearchResult {
  items: SearchResultItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  facets: SearchFacets;
  /** Echoes back the query actually run (after clamping/defaults) — a page
   * component renders "٥ نتائج لـ «كذا»" from this, not from raw URL params. */
  query: SearchQuery;
}

/** What a storefront page depends on. It never touches Prisma, Postgres, or
 * `catalog` directly — only this interface, resolved through
 * `getSearchProvider()`. */
export interface SearchProvider {
  name: string;
  search(query: SearchQuery): Promise<SearchResult>;
}
