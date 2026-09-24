'use client';

import * as React from 'react';
import Link from 'next/link';

import {
  recordProductView,
  useRecentlyViewed,
  type RecentlyViewedEntry,
} from '@/lib/recently-viewed';
import { ProductImage } from '@/components/commerce/product-image';
import { ProductPrice } from '@/components/commerce/product-price';
import type { Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';

/** No visual output — mounted once on a product page to record the view.
 * A `useEffect` writing to an external store (`localStorage`) on mount is
 * exactly what effects are for; nothing here calls `setState`. */
export function RecordProductView(props: Omit<RecentlyViewedEntry, 'viewedAt'>) {
  const entry = props;
  React.useEffect(() => {
    recordProductView(entry);
    // Record once per mount (a fresh page load / navigation to this
    // product) — re-running on every render would just churn the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);
  return null;
}

export function RecentlyViewedRail({
  excludeProductId,
  locale,
  currency,
}: {
  excludeProductId: string;
  locale: Locale;
  currency: string;
}) {
  const entries = useRecentlyViewed(excludeProductId);
  const t = getDictionary(locale);

  if (entries.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-h4 text-(--color-text)">{t.product.recentlyViewed}</h2>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {entries.map((entry) => (
          <Link
            key={entry.id}
            href={`/${locale}/p/${entry.slug}`}
            className="flex w-36 shrink-0 flex-col gap-2 rounded-(--radius-surface) p-1 outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)/25"
          >
            <ProductImage src={entry.image?.src} alt={entry.image?.alt ?? ''} sizes="144px" />
            <p className="line-clamp-2 text-caption font-medium text-(--color-text)">
              {locale === 'ar' ? entry.nameAr : entry.nameEn}
            </p>
            <ProductPrice
              priceMinor={entry.priceMinor}
              currency={currency}
              locale={locale}
              className="text-sm"
            />
          </Link>
        ))}
      </div>
    </section>
  );
}
