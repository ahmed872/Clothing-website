// Imported from the specific file, not the `@/modules/core` barrel: the
// barrel also re-exports `db`, which is `server-only` and must never reach a
// file a client component can pull in (see `layout.tsx` for the same rule).
import { formatMoney, type Locale } from '@/modules/core/money';
import { cn } from '@/lib/utils';

export interface ProductPriceProps {
  /** Minor units (halalas/cents) — the same integer the database stores. */
  priceMinor: number;
  compareAtMinor?: number | null;
  currency?: string;
  locale?: Locale;
  className?: string;
}

/**
 * Renders the current price and, when a higher `compareAtMinor` is given, the
 * struck-through original beside it. Always Latin numerals and tabular
 * figures (ADR-023) regardless of locale.
 */
export function ProductPrice({
  priceMinor,
  compareAtMinor,
  currency,
  locale = 'ar',
  className,
}: ProductPriceProps) {
  const onSale = typeof compareAtMinor === 'number' && compareAtMinor > priceMinor;

  return (
    <div className={cn('flex items-baseline gap-2', className)}>
      <span
        className={cn(
          'tabular-nums text-price',
          onSale ? 'text-(--color-error)' : 'text-(--color-text)',
        )}
      >
        {formatMoney(priceMinor, { currency, locale })}
      </span>
      {onSale ? (
        <span className="tabular-nums text-small text-(--color-text-muted) line-through">
          {formatMoney(compareAtMinor, { currency, locale })}
        </span>
      ) : null}
    </div>
  );
}
