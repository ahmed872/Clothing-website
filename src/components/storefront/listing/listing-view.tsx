import { PackageSearch } from 'lucide-react';

import type { SearchResult } from '@/modules/search';
import type { Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getStoreSettings } from '@/modules/settings';
import { ProductGrid } from '@/components/storefront/product-grid';
import { FiltersPanel } from '@/components/storefront/listing/filters-panel';
import { FiltersDrawer } from '@/components/storefront/listing/filters-drawer';
import { SortSelect } from '@/components/storefront/listing/sort-select';
import { PaginationNav } from '@/components/storefront/listing/pagination-nav';
import { EmptyState } from '@/components/ui/empty-state';

export interface ListingViewProps {
  locale: Locale;
  result: SearchResult;
  emptyTitle?: string;
  emptyDescription?: string;
}

/** The one rendering of "a page of products with filters, sorting and
 * pagination" — the category page and the search page both build a
 * `SearchResult` through `@/modules/search` and hand it to this exact
 * component, so results never look or behave differently depending on how
 * you got there. */
export async function ListingView({
  locale,
  result,
  emptyTitle,
  emptyDescription,
}: ListingViewProps) {
  const t = getDictionary(locale);
  const settings = await getStoreSettings(locale);

  const filtersProps = {
    locale,
    currency: settings.currency,
    brands: result.facets.brands,
    selectedBrandSlugs: result.query.brandSlugs ?? [],
    attributes: result.facets.attributes,
    selectedAttributeFilters: result.query.attributeFilters ?? {},
    priceRange: result.facets.priceRange,
    selectedPriceMinMinor: result.query.priceMinMinor,
    selectedPriceMaxMinor: result.query.priceMaxMinor,
    inStockOnly: result.query.inStockOnly ?? false,
  };

  const hasFilters =
    filtersProps.brands.length > 0 || filtersProps.attributes.length > 0 || filtersProps.priceRange;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
      {hasFilters ? (
        <aside className="hidden w-64 shrink-0 lg:block">
          <FiltersPanel {...filtersProps} />
        </aside>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="tabular-nums text-small text-(--color-text-muted)">
            {t.listing.resultsCount(result.total)}
          </p>
          <div className="flex items-center gap-2">
            {hasFilters ? <FiltersDrawer {...filtersProps} /> : null}
            <SortSelect locale={locale} value={result.query.sort ?? 'featured'} />
          </div>
        </div>

        {result.items.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title={emptyTitle ?? t.listing.noResultsTitle}
            description={emptyDescription ?? t.listing.noResultsDescription}
          />
        ) : (
          <>
            <ProductGrid items={result.items} locale={locale} />
            <div className="flex justify-center pt-4">
              <PaginationNav locale={locale} page={result.page} pageCount={result.pageCount} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
