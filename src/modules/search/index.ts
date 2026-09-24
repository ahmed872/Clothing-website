/**
 * `search` — search service and providers. PostgreSQL first, external engine behind the same interface.
 *
 * May depend on: core, catalog
 * Must not depend on: cart, orders, payments
 *
 * P05: full implementation. `SearchProvider` is the seam a real search
 * engine plugs into later; the only implementation today is a thin,
 * documented wrapper over `catalog.listProducts` (see
 * `postgres-provider.ts`). Every storefront listing/search page calls
 * `getSearchProvider().search(...)` — never `catalog` directly — so the
 * backend really is swappable without a page rewrite.
 *
 * Other modules import `@/modules/search`, never a file inside it.
 */

export { getSearchProvider } from './provider-factory';

export { parseSearchParams, type RawSearchParams } from './schemas';

export type {
  SearchProvider,
  SearchQuery,
  SearchResult,
  SearchResultItem,
  SearchFacets,
  SearchSort,
} from './provider';
