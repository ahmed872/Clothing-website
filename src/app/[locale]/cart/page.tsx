import type { Metadata } from 'next';

import { getCartView } from '@/modules/cart';
import { getStoreSettings } from '@/modules/settings';
import { isLocale, type Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { resolveCartOwnerForRead } from '@/lib/cart/cart-identity';
import { StorefrontBreadcrumbs } from '@/components/storefront/listing/storefront-breadcrumbs';
import { CartClient } from '@/components/storefront/cart/cart-client';

/**
 * The cart is per-person and recalculated on every visit, so it is never
 * cached — `resolveCartOwnerForRead` reads a cookie, which makes this route
 * dynamic anyway, but saying so is clearer than relying on that. The rest
 * of the storefront keeps its ISR untouched (P09 §23).
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  return {
    title: getDictionary(locale).cart.title,
    // A basket is personal and has no business in a search index.
    robots: { index: false, follow: true },
  };
}

export default async function CartPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  const t = getDictionary(locale);

  const [cart, settings] = await Promise.all([
    getCartView(await resolveCartOwnerForRead()),
    getStoreSettings(locale),
  ]);

  return (
    <div className="container mx-auto flex flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <StorefrontBreadcrumbs locale={locale} trail={[{ label: t.cart.title }]} />

      <h1 className="text-h3 text-(--color-text)">{t.cart.title}</h1>

      <CartClient initialCart={cart} locale={locale} currency={settings.currency} />
    </div>
  );
}
