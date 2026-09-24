import Link from 'next/link';

import type { Locale } from '@/modules/core/money';
import { cn } from '@/lib/utils';
import { ProductImage } from '@/components/commerce/product-image';
import { ProductPrice } from '@/components/commerce/product-price';
import { DiscountBadge } from '@/components/commerce/discount-badge';
import { StockBadge, type StockStatus } from '@/components/commerce/stock-badge';
import { Rating } from '@/components/commerce/rating';

export interface ProductCardProps {
  href: string;
  name: string;
  /** Shown as a small caption above the name — omitted products (no brand)
   * simply don't render one, rather than an empty line. */
  brand?: string | null;
  image?: { src: string; alt: string } | null;
  priceMinor: number;
  compareAtMinor?: number | null;
  currency?: string;
  locale?: Locale;
  ratingValue?: number;
  ratingCount?: number;
  stockStatus?: StockStatus;
  /** A caller-formatted string like "٣ خيارات" / "3 options" — left to the
   * caller so this component never owns pluralization/locale-count rules. */
  variantIndication?: string | null;
  /** Rendered as an overlay in the image's top-end corner — a wishlist
   * toggle, a quick-view trigger, both, or neither. Kept as a slot rather
   * than built-in props so this stays a purely presentational primitive:
   * wishlist state and quick-view behaviour are storefront concerns, not
   * this component's. */
  actionsSlot?: React.ReactNode;
  className?: string;
}

/**
 * Purely presentational: the grid tile used across storefront listing pages.
 * Add-to-cart and stock/pricing rules live in `cart`/`pricing` — this
 * component only renders what it's given. Hierarchy over density: name,
 * price and a single discount/stock signal read first; brand and rating are
 * secondary; everything else is an opt-in slot.
 */
export function ProductCard({
  href,
  name,
  brand,
  image,
  priceMinor,
  compareAtMinor,
  currency,
  locale,
  ratingValue,
  ratingCount,
  stockStatus,
  variantIndication,
  actionsSlot,
  className,
}: ProductCardProps) {
  const percentOff =
    compareAtMinor && compareAtMinor > priceMinor
      ? ((compareAtMinor - priceMinor) / compareAtMinor) * 100
      : 0;

  return (
    <div className={cn('group relative flex flex-col gap-3', className)}>
      <Link
        href={href}
        className="flex flex-col gap-3 rounded-(--radius-surface) p-2 outline-none transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-(--color-ring)/25"
      >
        <div className="relative">
          <ProductImage
            src={image?.src}
            alt={image?.alt ?? name}
            className="transition-transform duration-(--duration-slow) ease-(--ease-standard) group-hover:scale-[1.02]"
            noImageLabel={locale === 'en' ? 'No image' : undefined}
          />
          {percentOff > 0 ? (
            <DiscountBadge percentOff={percentOff} className="absolute top-2 start-2" />
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          {brand ? (
            <p className="text-caption text-(--color-text-muted) uppercase">{brand}</p>
          ) : null}
          <p className="line-clamp-2 text-sm font-medium text-(--color-text)">{name}</p>

          {ratingValue !== undefined ? (
            <Rating value={ratingValue} count={ratingCount} locale={locale} />
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <ProductPrice
              priceMinor={priceMinor}
              compareAtMinor={compareAtMinor}
              currency={currency}
              locale={locale}
            />
            {stockStatus && stockStatus !== 'in-stock' ? (
              <StockBadge status={stockStatus} locale={locale} />
            ) : null}
          </div>

          {variantIndication ? (
            <p className="text-caption text-(--color-text-muted)">{variantIndication}</p>
          ) : null}
        </div>
      </Link>

      {actionsSlot ? (
        <div className="absolute top-2 end-2 flex flex-col gap-1.5">{actionsSlot}</div>
      ) : null}
    </div>
  );
}
