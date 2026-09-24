import type { Metadata } from 'next';

import { getCachedCategoryTree } from '@/lib/cached-queries';
import { isLocale, type Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { StorefrontBreadcrumbs } from '@/components/storefront/listing/storefront-breadcrumbs';
import { WishlistClient } from '@/components/storefront/wishlist-client';

/**
 * The wishlist page.
 *
 * The header's heart icon has linked here since the storefront was built,
 * and until now the route did not exist — every visitor who pressed it got
 * a 404. The toggle, the count badge and the `localStorage` list were all
 * real; only this was missing.
 *
 * The page itself renders nothing personal on the server: the saved ids
 * live in the browser, so this is a title and a shell around
 * `WishlistClient`, which asks the server what the ids refer to. The one
 * thing resolved here is where "browse products" should go, since the
 * client component cannot query the catalog.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  return {
    title: getDictionary(locale).wishlistPage.title,
    // A saved-items list is personal, and its contents are not even on the
    // server — there is nothing here for a search index.
    robots: { index: false, follow: true },
  };
}

export default async function WishlistPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  const t = getDictionary(locale);

  // The first category, or the homepage when the store has none yet — a
  // "browse products" button must never be the second dead link on this
  // page.
  const categories = await getCachedCategoryTree();
  const browseHref = categories[0] ? `/${locale}/c/${categories[0].slug}` : `/${locale}`;

  return (
    <div className="container mx-auto flex flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <StorefrontBreadcrumbs locale={locale} trail={[{ label: t.wishlistPage.title }]} />

      <div className="flex flex-col gap-1">
        <h1 className="text-h3 text-(--color-text)">{t.wishlistPage.title}</h1>
        <p className="text-small text-(--color-text-muted)">{t.wishlistPage.description}</p>
      </div>

      <WishlistClient
        locale={locale}
        browseHref={browseHref}
        labels={{
          countLabel: t.wishlistPage.countLabel,
          emptyTitle: t.wishlistPage.emptyTitle,
          emptyDescription: t.wishlistPage.emptyDescription,
          browse: t.wishlistPage.browse,
          storageNotice: t.wishlistPage.storageNotice,
          unavailableNotice: t.wishlistPage.unavailableNotice,
        }}
      />
    </div>
  );
}
