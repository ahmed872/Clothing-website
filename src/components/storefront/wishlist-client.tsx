'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';

import type { ProductListingItem } from '@/modules/catalog';
import { useWishlist } from '@/lib/wishlist';
import { getWishlistProductsAction } from '@/lib/wishlist-actions';
import type { Locale } from '@/lib/i18n/locales';
import { ProductGrid } from '@/components/storefront/product-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The wishlist, rendered from ids that only the browser has.
 *
 * The header has linked to `/[locale]/wishlist` since the storefront was
 * built, and until now that link 404'd — the toggle, the count badge and
 * the storage all existed; the page did not. This is that page.
 *
 * It has to be a client component: the list lives in `localStorage`
 * (`lib/wishlist.ts`), so the server has no way to know what to render
 * until the browser tells it. The ids go to a Server Action, which returns
 * only published products — so an item that was unpublished or deleted
 * since it was saved quietly drops out rather than rendering as a broken
 * card, and the page says so when that happens.
 *
 * `ids` comes from `useWishlist`, so removing something from the grid
 * updates this page and the header's badge together, with no reload.
 */
export interface WishlistLabels {
  /** Carries `{count}`, interpolated here. */
  countLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  browse: string;
  storageNotice: string;
  unavailableNotice: string;
}

export function WishlistClient({
  locale,
  browseHref,
  labels,
}: {
  locale: Locale;
  /** Where "browse products" goes — the store's first category, or the
   * homepage when it has none. Resolved on the server, since this component
   * cannot query the catalog. */
  browseHref: string;
  labels: WishlistLabels;
}) {
  const { ids } = useWishlist();
  const [resolved, setResolved] = useState<ProductListingItem[] | null>(null);

  useEffect(() => {
    // An empty wishlist needs no request, and answering it here would mean
    // a synchronous `setState` in an effect — a cascading render for a
    // result that is already known. It is derived below instead.
    if (ids.length === 0) return;

    let cancelled = false;
    void getWishlistProductsAction(ids, locale).then((products) => {
      if (!cancelled) setResolved(products);
    });

    return () => {
      cancelled = true;
    };
  }, [ids, locale]);

  /**
   * What to render, derived rather than stored.
   *
   * Two things fall out of deriving it. An empty list is empty immediately,
   * with no request and no effect. And removing an item takes its card off
   * the page at once — `resolved` still holds the stale row until the
   * refetch lands, so it is filtered against the ids that are actually
   * saved now.
   */
  const items =
    ids.length === 0
      ? []
      : resolved === null
        ? null
        : resolved.filter((item) => ids.includes(item.id));

  // `null` is "we have not asked yet", which on the first paint is also
  // what a server render produces (`localStorage` is unreadable there) —
  // so the skeleton is the honest state, not an empty wishlist.
  if (items === null) {
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: Math.min(ids.length || 4, 8) }).map((_, index) => (
          <div key={index} className="flex flex-col gap-3">
            <Skeleton className="aspect-4/3 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Heart}
        title={labels.emptyTitle}
        description={labels.emptyDescription}
        action={
          <Button asChild>
            <Link href={browseHref}>{labels.browse}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-small text-(--color-text-muted)">
        {labels.countLabel.replace('{count}', String(items.length))}
      </p>

      {items.length < ids.length ? (
        <p className="text-small text-(--color-text-muted)">{labels.unavailableNotice}</p>
      ) : null}

      <ProductGrid items={items} locale={locale} />

      <p className="text-caption text-(--color-text-subtle)">{labels.storageNotice}</p>
    </div>
  );
}
