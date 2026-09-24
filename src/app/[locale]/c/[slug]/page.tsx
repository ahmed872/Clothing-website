import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getCategoryBySlug, getAncestorChain } from '@/modules/catalog';
import { getSearchProvider, parseSearchParams, type RawSearchParams } from '@/modules/search';
import { clientEnv } from '@/modules/core/env.client';
import { isLocale, type Locale } from '@/lib/i18n/locales';
import { StorefrontBreadcrumbs } from '@/components/storefront/listing/storefront-breadcrumbs';
import { ListingView } from '@/components/storefront/listing/listing-view';
import { StructuredData } from '@/components/storefront/structured-data';

export const revalidate = 60;

interface CategoryPageParams {
  locale: string;
  slug: string;
}

async function resolveCategory(params: Promise<CategoryPageParams>) {
  const { locale: rawLocale, slug } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : 'ar';
  const category = await getCategoryBySlug(slug);
  return { locale, slug, category };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<CategoryPageParams>;
}): Promise<Metadata> {
  const { locale, category } = await resolveCategory(params);
  if (!category) return {};

  const name = locale === 'ar' ? category.nameAr : category.nameEn;
  const seoTitle = (locale === 'ar' ? category.seoTitleAr : category.seoTitleEn) ?? name;
  const description = locale === 'ar' ? category.seoDescriptionAr : category.seoDescriptionEn;

  return {
    title: seoTitle,
    description: description ?? undefined,
    alternates: {
      canonical: `/${locale}/c/${category.slug}`,
      languages: {
        ar: `/ar/c/${category.slug}`,
        en: `/en/c/${category.slug}`,
        'x-default': `/ar/c/${category.slug}`,
      },
    },
    openGraph: { title: seoTitle, description: description ?? undefined },
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<CategoryPageParams>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { locale, category } = await resolveCategory(params);
  if (!category) notFound();

  const [rawSearchParams, breadcrumbChain] = await Promise.all([
    searchParams,
    getAncestorChain(category.id),
  ]);

  const query = parseSearchParams(rawSearchParams, {
    categorySlug: category.slug,
    locale,
    pageSize: 24,
  });
  const result = await getSearchProvider().search(query);

  const trail = breadcrumbChain.map((c, index) => ({
    label: locale === 'ar' ? c.nameAr : c.nameEn,
    href: index === breadcrumbChain.length - 1 ? undefined : `/${locale}/c/${c.slug}`,
  }));

  const siteUrl = clientEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: locale === 'ar' ? 'الرئيسية' : 'Home',
        item: `${siteUrl}/${locale}`,
      },
      ...trail.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 2,
        name: item.label,
        item: item.href ? `${siteUrl}${item.href}` : `${siteUrl}/${locale}/c/${category.slug}`,
      })),
    ],
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <StructuredData data={breadcrumbJsonLd} />
      <StorefrontBreadcrumbs locale={locale} trail={trail} />

      <div className="flex flex-col gap-2">
        <h1 className="text-h2 text-(--color-text)">
          {locale === 'ar' ? category.nameAr : category.nameEn}
        </h1>
        {(locale === 'ar' ? category.descriptionAr : category.descriptionEn) ? (
          <p className="max-w-2xl text-small text-(--color-text-muted)">
            {locale === 'ar' ? category.descriptionAr : category.descriptionEn}
          </p>
        ) : null}
      </div>

      <ListingView locale={locale} result={result} />
    </div>
  );
}
