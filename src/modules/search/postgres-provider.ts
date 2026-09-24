import {
  getCategoryBySlug,
  getFilterableAttributes,
  listBrands,
  listProducts,
  type ProductListingQuery,
} from '@/modules/catalog';

import type { SearchProvider, SearchQuery, SearchResult } from './provider';

/**
 * Today's one real implementation of `SearchProvider`: PostgreSQL, via
 * `catalog.listProducts`, with no separate search index. Correct for this
 * catalog's current size (see `product-listing.service.ts`'s scale note);
 * the interface is what makes replacing this with a real search engine an
 * addition, not a storefront rewrite.
 */
export const postgresSearchProvider: SearchProvider = {
  name: 'postgres',

  async search(query: SearchQuery): Promise<SearchResult> {
    const locale = query.locale ?? 'ar';

    const category = query.categorySlug ? await getCategoryBySlug(query.categorySlug) : null;

    const brandIds = query.brandSlugs?.length
      ? (await listBrands()).filter((b) => query.brandSlugs!.includes(b.slug)).map((b) => b.id)
      : undefined;

    const listingQuery: ProductListingQuery = {
      categoryId: category?.id,
      brandIds,
      attributeFilters: query.attributeFilters,
      priceMinMinor: query.priceMinMinor,
      priceMaxMinor: query.priceMaxMinor,
      inStockOnly: query.inStockOnly,
      q: query.q,
      sort: query.sort === 'relevance' ? undefined : query.sort,
      page: query.page,
      pageSize: query.pageSize,
    };

    const [result, attributes] = await Promise.all([
      listProducts(listingQuery, locale),
      category ? getFilterableAttributes(category.id) : Promise.resolve([]),
    ]);

    return {
      items: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      pageCount: result.pageCount,
      facets: {
        brands: result.availableBrands,
        attributes,
        priceRange: result.priceRange,
      },
      query,
    };
  },
};
