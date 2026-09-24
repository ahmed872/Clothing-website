import { MessageSquareText } from 'lucide-react';

import type { ProductReview } from '@/modules/catalog';
import type { Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { Rating } from '@/components/commerce/rating';
import { EmptyState } from '@/components/ui/empty-state';

/** Real reviews only — no rows means the honest empty state, never a
 * fabricated rating (the same rule P04 applied to media). */
export function ReviewsSection({
  reviews,
  rating,
  locale,
}: {
  reviews: ProductReview[];
  rating: { value: number; count: number } | null;
  locale: Locale;
}) {
  const t = getDictionary(locale);

  if (reviews.length === 0) {
    return (
      <EmptyState
        icon={MessageSquareText}
        title={t.product.noReviewsTitle}
        description={t.product.noReviewsDescription}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {rating ? (
        <div className="flex items-center gap-3">
          <p className="text-h3 tabular-nums text-(--color-text)">{rating.value.toFixed(1)}</p>
          <div className="flex flex-col gap-1">
            <Rating value={rating.value} size="md" locale={locale} />
            <p className="tabular-nums text-caption text-(--color-text-muted)">
              {rating.count} {locale === 'ar' ? 'تقييم' : 'reviews'}
            </p>
          </div>
        </div>
      ) : null}

      <ul className="flex flex-col gap-5">
        {reviews.map((review) => (
          <li
            key={review.id}
            className="flex flex-col gap-1.5 border-b border-(--color-border) pb-5"
          >
            <div className="flex items-center justify-between gap-2">
              <Rating value={review.rating} size="sm" locale={locale} />
              <time
                dateTime={review.createdAt.toISOString()}
                className="tabular-nums text-caption text-(--color-text-muted)"
              >
                {new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: 'medium' }).format(
                  review.createdAt,
                )}
              </time>
            </div>
            {review.title ? (
              <p className="text-sm font-semibold text-(--color-text)">{review.title}</p>
            ) : null}
            {review.body ? (
              <p className="text-small text-(--color-text-muted)">{review.body}</p>
            ) : null}
            <p className="text-caption text-(--color-text-muted)">{review.customerName}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
