import type { Metadata } from 'next';

import { buildFallbackHomepageSections, getPublishedHomepageSections } from '@/modules/content';
import { getCachedStoreSettings } from '@/lib/cached-queries';
import { isLocale, type Locale } from '@/lib/i18n/locales';
import { SectionRenderer } from '@/components/storefront/sections/section-renderer';
import { EmptyState } from '@/components/ui/empty-state';

// `generateStaticParams` (in the layout) makes this route static by
// default — without a `revalidate`, the prerendered HTML would never pick
// up a newly published/edited HomepageSection. 60s matches the other
// catalog-backed routes (`/c/[slug]`, `/p/[slug]`).
export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : 'ar';
  const settings = await getCachedStoreSettings(locale);
  const title = locale === 'ar' ? settings.seoDefaults.titleAr : settings.seoDefaults.titleEn;
  const description =
    locale === 'ar' ? settings.seoDefaults.descriptionAr : settings.seoDefaults.descriptionEn;

  return {
    title: title ?? undefined,
    description,
    alternates: {
      canonical: `/${locale}`,
      languages: { ar: '/ar', en: '/en', 'x-default': '/ar' },
    },
    openGraph: {
      title: title ?? (locale === 'ar' ? settings.storeNameAr : settings.storeNameEn),
      description,
    },
  };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : 'ar';
  const published = await getPublishedHomepageSections(locale);

  // A store that has published products but not yet built a homepage gets
  // its products shown rather than a notice written for its own admin —
  // see `buildFallbackHomepageSections`. The empty state below is for a
  // store with genuinely nothing to show.
  const sections = published.length > 0 ? published : await buildFallbackHomepageSections(locale);

  if (sections.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <EmptyState
          title={locale === 'ar' ? 'المتجر قيد التجهيز' : 'The store is being set up'}
          description={
            locale === 'ar'
              ? 'لم يتم نشر أي محتوى للصفحة الرئيسية بعد.'
              : 'No homepage content has been published yet.'
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-12 px-4 py-8 sm:px-6 sm:py-12">
      {sections.map((section) => (
        <SectionRenderer key={section.id} section={section} locale={locale} />
      ))}
    </div>
  );
}
