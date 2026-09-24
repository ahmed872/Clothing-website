import type { ProductListingItem } from '@/modules/catalog';
import type { Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { cn } from '@/lib/utils';
import { ProductCard } from '@/components/commerce/product-card';
import { WishlistToggleButton } from '@/components/storefront/wishlist-toggle-button';
import { QuickViewDialog } from '@/components/storefront/quick-view-dialog';

export interface ProductGridProps {
  items: ProductListingItem[];
  locale: Locale;
  className?: string;
}

function variantIndicationLabel(count: number, locale: Locale): string | null {
  if (count <= 1) return null;
  // A simple, honest label rather than full Arabic plural-rule grammar
  // (0/1/2/few/many/other) for a one-line badge — "٣ خيارات" reads fine
  // for every count even though a linguist would pick a different word for
  // exactly two.
  return locale === 'ar' ? `${count} خيارات` : `${count} options`;
}

/** The one grid every listing surface (homepage rails, category pages,
 * search results, related products) renders through, so a card never looks
 * or behaves differently depending on where it's shown. */
export function ProductGrid({ items, locale, className }: ProductGridProps) {
  const t = getDictionary(locale);

  return (
    <div
      className={cn('grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4', className)}
    >
      {items.map((item) => (
        <ProductCard
          key={item.id}
          href={`/${locale}/p/${item.slug}`}
          name={locale === 'ar' ? item.nameAr : item.nameEn}
          brand={item.brand ? (locale === 'ar' ? item.brand.nameAr : item.brand.nameEn) : null}
          image={item.image}
          priceMinor={item.price.currentMinor}
          compareAtMinor={item.price.compareAtMinor}
          locale={locale}
          ratingValue={item.rating?.value}
          ratingCount={item.rating?.count}
          stockStatus={item.stockStatus}
          variantIndication={variantIndicationLabel(item.variantCount, locale)}
          actionsSlot={
            <>
              <WishlistToggleButton
                productId={item.id}
                addLabel={t.product.wishlistAdd}
                removeLabel={t.product.wishlistRemove}
              />
              <QuickViewDialog
                href={`/${locale}/p/${item.slug}`}
                name={locale === 'ar' ? item.nameAr : item.nameEn}
                brand={
                  item.brand ? (locale === 'ar' ? item.brand.nameAr : item.brand.nameEn) : null
                }
                image={item.image}
                priceMinor={item.price.currentMinor}
                compareAtMinor={item.price.compareAtMinor}
                locale={locale}
                stockStatus={item.stockStatus}
                triggerLabel={locale === 'ar' ? 'عرض سريع' : 'Quick view'}
                viewDetailsLabel={locale === 'ar' ? 'عرض التفاصيل الكاملة' : 'View full details'}
                closeLabel={locale === 'ar' ? 'إغلاق' : 'Close'}
              />
            </>
          }
        />
      ))}
    </div>
  );
}
