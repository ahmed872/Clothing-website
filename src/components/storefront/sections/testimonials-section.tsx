import type { TestimonialsSectionView } from '@/modules/content';
import type { Locale } from '@/lib/i18n/locales';
import { Rating } from '@/components/commerce/rating';

export function TestimonialsSection({
  section,
  locale,
}: {
  section: TestimonialsSectionView;
  locale: Locale;
}) {
  const title = locale === 'ar' ? section.titleAr : section.titleEn;

  return (
    <section className="flex flex-col gap-5">
      {title ? <h2 className="text-h3 text-(--color-text)">{title}</h2> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {section.items.map((item, index) => (
          <figure
            key={index}
            className="flex flex-col gap-3 rounded-(--radius-surface) border border-(--color-border) bg-(--color-surface) p-5"
          >
            {item.rating != null ? <Rating value={item.rating} locale={locale} /> : null}
            <blockquote className="text-small text-(--color-text)">
              “{locale === 'ar' ? item.quoteAr : item.quoteEn}”
            </blockquote>
            <figcaption className="mt-auto flex flex-col text-caption text-(--color-text-muted)">
              <span className="font-medium text-(--color-text)">{item.authorName}</span>
              {(locale === 'ar' ? item.authorTitleAr : item.authorTitleEn) ? (
                <span>{locale === 'ar' ? item.authorTitleAr : item.authorTitleEn}</span>
              ) : null}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
