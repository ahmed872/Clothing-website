'use server';

import { listProducts, type ProductListingItem } from '@/modules/catalog';
import type { Locale } from '@/lib/i18n/locales';

/**
 * Resolve the wishlist's stored product ids into real, renderable products.
 *
 * The wishlist itself lives in `localStorage` (`lib/wishlist.ts`) because
 * there is no per-customer persistence for it — so the ids only exist in
 * the browser, and the page that renders them has to ask the server what
 * they refer to. That is what this is for.
 *
 * **Unauthenticated on purpose, and safe.** It returns exactly what an
 * anonymous visitor can already see on `/c/[slug]`: `listProducts` filters
 * to PUBLISHED products, so a guessed id reveals nothing that isn't already
 * on a public page. It takes no other input and writes nothing.
 *
 * The cap is what keeps that true of a *large* request too — a wishlist is
 * a handful of things someone liked, and an unbounded id list would turn a
 * public endpoint into a way to dump the catalog in one call.
 */
const MAX_WISHLIST_ITEMS = 60;

export async function getWishlistProductsAction(
  productIds: string[],
  locale: Locale,
): Promise<ProductListingItem[]> {
  const ids = productIds.filter((id) => typeof id === 'string').slice(0, MAX_WISHLIST_ITEMS);
  if (ids.length === 0) return [];

  const result = await listProducts({ productIds: ids, pageSize: ids.length }, locale);

  // Returned in the order they were saved, newest last — the order the
  // person built the list in, not the order the query happened to produce.
  // An id whose product has been unpublished or deleted simply drops out,
  // exactly as a curated homepage rail treats one.
  const byId = new Map(result.items.map((item) => [item.id, item]));
  return ids
    .map((id) => byId.get(id))
    .filter((item): item is ProductListingItem => item !== undefined);
}
