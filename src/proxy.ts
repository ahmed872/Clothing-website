import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  SUPPORTED_LOCALES,
  isLocale,
  type Locale,
} from '@/lib/i18n/locales';

/**
 * Locale routing (P05). Every storefront page lives under `/ar/...` or
 * `/en/...` (`app/[locale]/...`); a request with no locale prefix is
 * redirected to one, detected from a saved preference cookie, then the
 * browser's `Accept-Language` header, falling back to the store's default
 * (Arabic, ADR-023). `/dev/gallery` (P02), `/admin` (P06 — its own root
 * layout reads the same cookie directly, with no URL locale prefix), and
 * everything else this matcher excludes are untouched — they're not
 * storefront content.
 *
 * Deliberately minimal and dependency-light, per the Next.js proxy docs:
 * this runs ahead of and separately from render, so it only ever imports
 * the small, standalone `lib/i18n/locales` module — never `@/modules/*`.
 */

function detectLocale(request: NextRequest): Locale {
  const cookieLocale = request.cookies.get(LOCALE_COOKIE_NAME)?.value;
  if (cookieLocale && isLocale(cookieLocale)) return cookieLocale;

  const acceptLanguage = request.headers.get('accept-language');
  if (acceptLanguage) {
    for (const part of acceptLanguage.split(',')) {
      const tag = part.split(';')[0]?.trim().toLowerCase();
      const primary = tag?.split('-')[0];
      if (primary && isLocale(primary)) return primary;
    }
  }

  return DEFAULT_LOCALE;
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const alreadyLocalized = SUPPORTED_LOCALES.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );
  if (alreadyLocalized) return NextResponse.next();

  const locale = detectLocale(request);
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;

  const response = NextResponse.redirect(url);
  response.cookies.set(LOCALE_COOKIE_NAME, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  return response;
}

export const config = {
  matcher: [
    // Everything except Next internals, API routes, the P02 design-system
    // gallery (locale-agnostic dev tool), the admin area (its own
    // non-locale-prefixed root layout), and requests for a file
    // (favicon.ico, robots.txt, sitemap.xml, or anything with an extension).
    '/((?!_next|api|dev|admin|.*\\..*).*)',
  ],
};
