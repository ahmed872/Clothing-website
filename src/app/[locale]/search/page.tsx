import type { Metadata } from 'next';

import { getSearchProvider, parseSearchParams, type RawSearchParams } from '@/modules/search';
import { isLocale, type Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { ListingView } from '@/components/storefront/listing/listing-view';
import { StorefrontBreadcrumbs } from '@/components/storefront/listing/storefront-breadcrumbs';

interface SearchPageParams {
  locale: string;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<SearchPageParams>;
  searchParams: Promise<RawSearchParams>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : 'ar';
  const t = getDictionary(locale);
  const raw = await searchParams;
  const q = typeof raw.q === 'string' ? raw.q : undefined;

  return {
    title: q ? t.search.title(q) : t.nav.search,
    // Search results are never indexed — the canonical, crawlable surface
    // for the same products is the category page, not an arbitrary query
    // string (P05 SEO requirement: "indexability rules").
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<SearchPageParams>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { locale: rawLocale } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : 'ar';
  const t = getDictionary(locale);
  const raw = await searchParams;
  const q = typeof raw.q === 'string' ? raw.q.trim() : '';

  const trail = [{ label: t.nav.search }];

  if (!q) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <StorefrontBreadcrumbs locale={locale} trail={trail} />
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <h1 className="text-h3 text-(--color-text)">{t.search.emptyTitle}</h1>
          <p className="max-w-md text-small text-(--color-text-muted)">
            {t.search.emptyDescription}
          </p>
        </div>
      </div>
    );
  }

  const query = parseSearchParams(raw, { locale, pageSize: 24 });
  const result = await getSearchProvider().search(query);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <StorefrontBreadcrumbs locale={locale} trail={trail} />
      <h1 className="text-h2 text-(--color-text)">{t.search.title(q)}</h1>
      <ListingView locale={locale} result={result} />
    </div>
  );
}
