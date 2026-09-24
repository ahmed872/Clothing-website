import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { ProductRailSectionView } from '@/modules/content';
import type { Locale } from '@/lib/i18n/locales';
import { ProductGrid } from '@/components/storefront/product-grid';

/** FEATURED_PRODUCTS, NEW_ARRIVALS, BEST_SELLERS and ACTIVE_OFFERS all
 * render identically — a titled product rail — because `content` already
 * resolved each into the same shape. An empty rail (a curated list whose
 * products all got unpublished, say) renders nothing rather than an
 * awkward empty grid; the section simply doesn't take up space. */
export function ProductRailSection({
  section,
  locale,
}: {
  section: ProductRailSectionView;
  locale: Locale;
}) {
  if (section.products.length === 0) return null;
  const title = locale === 'ar' ? section.titleAr : section.titleEn;

  return (
    <section className="flex flex-col gap-5">
      {title ? (
        <div className="flex items-center justify-between">
          <h2 className="text-h3 text-(--color-text)">{title}</h2>
          <Link
            href={`/${locale}/search?sort=${section.type === 'NEW_ARRIVALS' ? 'newest' : 'featured'}`}
            className="hidden items-center gap-1 text-sm font-medium text-(--color-primary) hover:underline sm:flex"
          >
            {locale === 'ar' ? 'عرض الكل' : 'View all'}
            {locale === 'ar' ? (
              <ChevronLeft className="size-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-4" aria-hidden="true" />
            )}
          </Link>
        </div>
      ) : null}
      <ProductGrid items={section.products} locale={locale} />
    </section>
  );
}
