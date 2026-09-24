import { Star } from 'lucide-react';

import type { Locale } from '@/modules/core/money';
import { cn } from '@/lib/utils';

export interface RatingProps {
  /** 0–5, fractional values render a partially-filled star. */
  value: number;
  count?: number;
  locale?: Locale;
  className?: string;
  size?: 'sm' | 'md';
}

const LABEL = {
  ar: (score: string, count?: number) =>
    count === undefined
      ? `التقييم ${score} من 5`
      : `التقييم ${score} من 5، بناءً على ${count} تقييم`,
  en: (score: string, count?: number) =>
    count === undefined ? `Rated ${score} out of 5` : `Rated ${score} out of 5, ${count} reviews`,
} satisfies Record<Locale, (score: string, count?: number) => string>;

/** Read-only star rating. A single `img`-role element with a full text
 * alternative — five separate icons would force screen readers to announce
 * "star, star, star…" instead of the one number that matters. */
export function Rating({ value, count, locale = 'ar', className, size = 'sm' }: RatingProps) {
  const clamped = Math.max(0, Math.min(5, value));
  const iconSize = size === 'sm' ? 'size-3.5' : 'size-4.5';
  const label = LABEL[locale](clamped.toFixed(1), count);

  return (
    <div role="img" aria-label={label} className={cn('flex items-center gap-1', className)}>
      <div className="relative flex" aria-hidden="true">
        <div className="flex text-(--color-border-strong)">
          {Array.from({ length: 5 }, (_, i) => (
            <Star key={i} className={iconSize} fill="currentColor" strokeWidth={0} />
          ))}
        </div>
        <div
          className="absolute inset-0 flex overflow-hidden text-(--color-accent)"
          style={{ width: `${(clamped / 5) * 100}%` }}
        >
          {Array.from({ length: 5 }, (_, i) => (
            <Star
              key={i}
              className={cn(iconSize, 'shrink-0')}
              fill="currentColor"
              strokeWidth={0}
            />
          ))}
        </div>
      </div>
      {count !== undefined ? (
        <span className="tabular-nums text-caption text-(--color-text-muted)">({count})</span>
      ) : null}
    </div>
  );
}
