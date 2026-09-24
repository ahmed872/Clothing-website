import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Direction } from 'radix-ui';

import { latin, arabic } from '@/lib/fonts';
import { THEME_BOOTSTRAP } from '@/lib/theme-bootstrap';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  directionForLocale,
  isLocale,
} from '@/lib/i18n/locales';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toast';

import '../globals.css';

/**
 * `/admin`'s own root layout (P06) — the storefront's "multiple root
 * layouts" pattern (`app/[locale]/layout.tsx`, `app/dev/layout.tsx`)
 * extended to a third sibling top-level segment. Unlike the storefront,
 * `/admin` has no `/ar`/`/en` URL prefix: it reads the same
 * `luxedrive-locale` cookie `proxy.ts` sets for the storefront, so a
 * visitor's language preference carries over, and `AdminLocaleToggle`
 * writes the same cookie back — one preference, not two.
 *
 * This has to be an actual root layout (not nested under `[locale]`)
 * precisely because `/admin` is not locale-*routed* — there is no `[locale]`
 * URL segment here for `generateStaticParams`/`notFound()` to key off, so
 * sharing that layout would either force a locale prefix onto every admin
 * URL (contradicting `pages.signIn: '/admin/login'` in `auth.ts`) or fail
 * to render at all.
 */
export const metadata: Metadata = {
  title: { default: 'LuxeDrive Admin', template: '%s — LuxeDrive Admin' },
  robots: { index: false, follow: false },
};

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const dir = directionForLocale(locale);

  return (
    <html lang={locale} dir={dir} className={`${latin.variable} ${arabic.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="bg-(--color-background) text-(--color-text)">
        <Direction.Provider dir={dir}>
          <TooltipProvider>
            {children}
            <Toaster closeLabel={locale === 'ar' ? 'إغلاق' : 'Close'} />
          </TooltipProvider>
        </Direction.Provider>
      </body>
    </html>
  );
}
