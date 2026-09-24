import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Direction } from 'radix-ui';

import { clientEnv } from '@/modules/core/env.client';
import { getCachedStoreSettings } from '@/lib/cached-queries';
import { latin, arabic } from '@/lib/fonts';
import { THEME_BOOTSTRAP } from '@/lib/theme-bootstrap';
import { SUPPORTED_LOCALES, directionForLocale, isLocale, type Locale } from '@/lib/i18n/locales';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toast';
import { StorefrontHeader } from '@/components/storefront/header';
import { StorefrontFooter } from '@/components/storefront/footer';

import '../globals.css';

/**
 * The storefront's root layout (P05) — every `/ar/*` and `/en/*` route
 * renders through this. Direction and language are resolved on the server
 * from the URL's locale segment, so the page never renders left-to-right and
 * then flips (ADR-023); `proxy.ts` is what gets a visitor to the right
 * `/[locale]` prefix in the first place.
 *
 * This *is* the app's root layout for the storefront branch — see
 * `app/dev/layout.tsx`'s docstring for why `/dev/*` needs its own sibling
 * root layout instead of sharing this one.
 */

export async function generateStaticParams(): Promise<{ locale: Locale }[]> {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale = isLocale(rawLocale) ? rawLocale : 'ar';
  const settings = await getCachedStoreSettings(locale);
  const siteUrl = clientEnv().NEXT_PUBLIC_SITE_URL;
  const storeName = locale === 'ar' ? settings.storeNameAr : settings.storeNameEn;

  return {
    metadataBase: new URL(siteUrl),
    title: { default: storeName, template: `%s — ${storeName}` },
    icons: settings.favicon ? { icon: settings.favicon.src } : undefined,
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) notFound();
  const locale = rawLocale;
  const dir = directionForLocale(locale);

  return (
    <html lang={locale} dir={dir} className={`${latin.variable} ${arabic.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <Direction.Provider dir={dir}>
          <TooltipProvider>
            <div className="flex min-h-screen flex-col bg-(--color-background) text-(--color-text)">
              <StorefrontHeader locale={locale} />
              <main id="main-content" className="flex-1">
                {children}
              </main>
              <StorefrontFooter locale={locale} />
            </div>
            <Toaster closeLabel={locale === 'ar' ? 'إغلاق' : 'Close'} />
          </TooltipProvider>
        </Direction.Provider>
      </body>
    </html>
  );
}
