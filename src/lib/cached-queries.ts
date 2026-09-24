import { unstable_cache } from 'next/cache';

import { getCategoryTree, type CategoryNode } from '@/modules/catalog';
import { getStoreSettings, type StoreSettingsView } from '@/modules/settings';
import type { Locale } from '@/lib/i18n/locales';

/**
 * `unstable_cache` wrappers for the handful of reads every storefront page
 * makes indirectly through `Header`/`Footer` (the category tree, store
 * settings) — cheap individually at this catalog's size, but worth caching
 * across requests rather than re-querying on every render, especially for
 * routes forced dynamic by `searchParams` (`/c/[slug]`, `/search`), which
 * get none of a static route's own caching for free.
 *
 * Lives in `lib`, not inside `catalog`/`settings` themselves: caching is a
 * Next.js delivery concern, and those modules stay framework-agnostic
 * domain services that know nothing about `next/cache`.
 *
 * Never applied to anything customer- or cart-specific — there is nothing
 * of that kind to cache yet (P05 is storefront-only), and this file must
 * stay that way when `cart`/`customers` land.
 */

export const getCachedCategoryTree = unstable_cache(
  async (): Promise<CategoryNode[]> => getCategoryTree(),
  ['storefront-category-tree'],
  { revalidate: 60, tags: ['catalog:categories'] },
);

export const getCachedStoreSettings = unstable_cache(
  async (locale: Locale): Promise<StoreSettingsView> => getStoreSettings(locale),
  ['storefront-store-settings'],
  { revalidate: 60, tags: ['settings:store'] },
);
