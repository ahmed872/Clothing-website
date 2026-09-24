import type { MetadataRoute } from 'next';

import { db } from '@/modules/core';
import { clientEnv } from '@/modules/core/env.client';
import { SUPPORTED_LOCALES } from '@/lib/i18n/locales';

/**
 * One entry per published, publicly-reachable URL, per locale — a category
 * or product only ever appears here if it's actually visible to a visitor
 * (`status: 'PUBLISHED'`, not soft-deleted), so the sitemap can never point
 * search engines at a page that 404s or is meant to stay unpublished.
 * `/search` is deliberately excluded (it's `noindex`, per its own
 * `generateMetadata`) — a sitemap listing a page search engines are told
 * not to index would be self-contradictory.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = clientEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');

  const [categories, products] = await Promise.all([
    db.category.findMany({ select: { slug: true, updatedAt: true } }),
    db.product.findMany({
      where: { status: 'PUBLISHED', deletedAt: null },
      select: { slug: true, updatedAt: true },
    }),
  ]);

  function localizedEntries(
    pathForLocale: (locale: string) => string,
    lastModified: Date,
    priority: number,
  ): MetadataRoute.Sitemap {
    const languages = Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [locale, `${siteUrl}${pathForLocale(locale)}`]),
    );
    return SUPPORTED_LOCALES.map((locale) => ({
      url: `${siteUrl}${pathForLocale(locale)}`,
      lastModified,
      changeFrequency: 'daily' as const,
      priority,
      alternates: { languages: { ...languages, 'x-default': languages.ar! } },
    }));
  }

  const homeEntries = localizedEntries((locale) => `/${locale}`, new Date(), 1);
  const categoryEntries = categories.flatMap((category) =>
    localizedEntries((locale) => `/${locale}/c/${category.slug}`, category.updatedAt, 0.8),
  );
  const productEntries = products.flatMap((product) =>
    localizedEntries((locale) => `/${locale}/p/${product.slug}`, product.updatedAt, 0.6),
  );

  return [...homeEntries, ...categoryEntries, ...productEntries];
}
