import Link from 'next/link';

import type { FeaturedCategoriesSectionView } from '@/modules/content';
import type { Locale } from '@/lib/i18n/locales';
import { ProductImage } from '@/components/commerce/product-image';

export function FeaturedCategoriesSection({
  section,
  locale,
}: {
  section: FeaturedCategoriesSectionView;
  locale: Locale;
}) {
  const title = locale === 'ar' ? section.titleAr : section.titleEn;

  return (
    <section className="flex flex-col gap-5">
      {title ? <h2 className="text-h3 text-(--color-text)">{title}</h2> : null}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {section.categories.map((category) => (
          <Link
            key={category.id}
            href={`/${locale}/c/${category.slug}`}
            className="group flex flex-col gap-2 rounded-(--radius-surface) p-1 outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)/25"
          >
            <ProductImage
              src={category.image?.src}
              alt={category.image?.alt ?? (locale === 'ar' ? category.nameAr : category.nameEn)}
              className="transition-transform duration-(--duration-slow) ease-(--ease-standard) group-hover:scale-[1.02]"
              sizes="(min-width: 768px) 22vw, 45vw"
            />
            <p className="text-center text-sm font-medium text-(--color-text)">
              {locale === 'ar' ? category.nameAr : category.nameEn}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
