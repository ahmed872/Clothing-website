/**
 * The two supported storefront locales. Deliberately dependency-free (no
 * imports at all) — this file is used from `proxy.ts`, which the Next.js
 * docs explicitly warn against wiring up to shared app modules ("Proxy is
 * meant to be invoked separately of your render code... you should not
 * attempt relying on shared modules or globals"), as well as from ordinary
 * server/client components.
 */
export const SUPPORTED_LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ar';

/** The one cookie that remembers a visitor's language preference —
 * `proxy.ts` sets/reads it for the URL-prefixed storefront; `/admin` (which
 * has no `/ar`/`/en` URL prefix of its own) reads the same cookie so a
 * person's language choice is one preference, not two. */
export const LOCALE_COOKIE_NAME = 'luxedrive-locale';

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function directionForLocale(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/** Swaps the leading `/ar` or `/en` segment of a storefront path for
 * `locale`, or prefixes it if the path has none — the one place a locale
 * switcher or canonical/hreflang builder computes "this same page, other
 * language" from. */
export function localizePath(pathname: string, locale: Locale): string {
  // Not `string | null` reduced by truthiness — the bare-locale-root case
  // strips to `''`, which is falsy, and a truthy check would then let a
  // later iteration overwrite that correct (empty) match with `null`.
  let rest = pathname;
  for (const l of SUPPORTED_LOCALES) {
    if (pathname === `/${l}`) {
      rest = '';
      break;
    }
    if (pathname.startsWith(`/${l}/`)) {
      rest = pathname.slice(`/${l}`.length);
      break;
    }
  }
  return `/${locale}${rest === '/' ? '' : rest}`;
}

/** For a CTA `href` stored in `content`'s section config (which has no
 * locale of its own — the same section renders on both `/ar` and `/en`):
 * an internal path (`/c/cars`, or already-locale-prefixed `/ar/c/cars`)
 * gets `locale` applied via `localizePath`; an absolute external URL
 * (`https://...`) or a same-page anchor (`#section`) passes through
 * untouched — those aren't storefront routes to localize. */
export function localizeHref(href: string, locale: Locale): string {
  if (!href.startsWith('/')) return href;
  return localizePath(href, locale);
}
