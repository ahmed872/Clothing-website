import { Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';

import { getCachedCategoryTree, getCachedStoreSettings } from '@/lib/cached-queries';
import { getDictionary } from '@/lib/i18n/dictionary';
import type { Locale } from '@/lib/i18n/locales';
import { NavLinks } from '@/components/storefront/nav-links';
import { SearchBar } from '@/components/storefront/search-bar';
import { LocaleSwitcher } from '@/components/storefront/locale-switcher';
import { ThemeToggle } from '@/components/storefront/theme-toggle';
import { WishlistNavLink } from '@/components/storefront/wishlist-nav-link';
import { CartNavLink } from '@/components/storefront/cart-nav-link';
import { MobileMenu } from '@/components/storefront/mobile-menu';

export interface StorefrontHeaderProps {
  locale: Locale;
}

/** A Server Component by default — it only reads (category tree, store
 * settings), so nothing here needs to ship as client JS. Every interactive
 * piece (search, menus, toggles) is its own small client component. */
export async function StorefrontHeader({ locale }: StorefrontHeaderProps) {
  const t = getDictionary(locale);
  const [categories, settings] = await Promise.all([
    getCachedCategoryTree(),
    getCachedStoreSettings(locale),
  ]);
  const topCategories = categories.map((c) => ({
    slug: c.slug,
    nameAr: c.nameAr,
    nameEn: c.nameEn,
  }));
  const storeName = locale === 'ar' ? settings.storeNameAr : settings.storeNameEn;

  return (
    <header className="sticky top-0 z-40 border-b border-(--color-border) bg-(--color-surface)/95 backdrop-blur-sm">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:rounded-(--radius-control) focus:bg-(--color-primary) focus:px-4 focus:py-2 focus:text-(--color-primary-foreground)"
      >
        {locale === 'ar' ? 'تخطَّ إلى المحتوى' : 'Skip to content'}
      </a>

      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
        <MobileMenu
          locale={locale}
          categories={topCategories}
          labels={{
            menu: t.nav.menu,
            close: t.nav.closeMenu,
            search: t.nav.search,
            allCategories: t.nav.allCategories,
          }}
        />

        <Link
          href={`/${locale}`}
          className="flex shrink-0 items-center gap-2 rounded-(--radius-sm) outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)/25"
        >
          {settings.logo ? (
            <Image
              src={settings.logo.src}
              alt={settings.logo.alt || storeName}
              width={32}
              height={32}
              className="size-8 rounded-(--radius-sm) object-contain"
            />
          ) : null}
          <span className="text-h6 font-bold text-(--color-text)">{storeName}</span>
        </Link>

        <NavLinks locale={locale} categories={topCategories} className="hidden md:flex" />

        <Suspense fallback={<div className="mx-auto hidden h-10 max-w-md flex-1 md:flex" />}>
          <SearchBar
            locale={locale}
            placeholder={t.nav.search}
            submitLabel={t.nav.searchLabel}
            className="mx-auto hidden max-w-md flex-1 md:flex"
          />
        </Suspense>

        <div className="ms-auto flex items-center gap-1">
          <Suspense fallback={<div className="h-9 w-20" />}>
            <LocaleSwitcher locale={locale} label={t.nav.language} />
          </Suspense>
          <ThemeToggle label={t.nav.theme} />
          <WishlistNavLink locale={locale} label={t.nav.wishlist} />
          <CartNavLink locale={locale} label={t.nav.cart} />
        </div>
      </div>

      <div className="border-t border-(--color-border) px-4 py-2 md:hidden">
        <Suspense fallback={<div className="h-10" />}>
          <SearchBar locale={locale} placeholder={t.nav.search} submitLabel={t.nav.searchLabel} />
        </Suspense>
      </div>
    </header>
  );
}
