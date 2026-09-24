import type { Locale } from '@/lib/i18n/locales';

/**
 * The one function allowed to decide where a login redirects to (P12 §17).
 *
 * `redirect()` accepts absolute URLs and will happily send a browser to one
 * (confirmed directly against Next's own docs) — so a `next` value taken
 * from a query string and handed to `redirect()` unchecked is a textbook
 * open redirect: `?next=https://evil.example` would work exactly as well as
 * `?next=/ar/account`. This function is the single point everything a
 * customer could have supplied passes through before it's ever used as a
 * destination.
 *
 * Accepted: a path that starts with exactly `/${locale}/`, so a redirect
 * always lands back in the same locale it left from and never leaves the
 * storefront's own `[locale]` tree (never `/admin`, which isn't
 * locale-prefixed at all — this rule excludes it by construction).
 * Rejected: anything absolute (`https://…`), protocol-relative (`//host/…`,
 * which browsers resolve as a scheme-relative absolute URL), or that
 * doesn't parse as a same-origin relative path at all.
 */
export function safeAccountRedirect(locale: Locale, raw: string | null | undefined): string {
  const fallback = `/${locale}/account`;
  if (!raw) return fallback;

  // `//evil.example` is not caught by a bare `startsWith('/')` check — the
  // browser reads two leading slashes as "same scheme, different host."
  if (raw.startsWith('//')) return fallback;
  if (!raw.startsWith(`/${locale}/`) && raw !== `/${locale}`) return fallback;

  // Belt and braces: resolve it against a fixed, known-safe origin and
  // require the parsed result to still be that exact origin. A value like
  // `/ar/@evil.example` or one carrying backslash tricks a browser might
  // still interpret as a host change fails this even if the string checks
  // above somehow missed it.
  try {
    const resolved = new URL(raw, 'https://luxedrive.internal');
    if (resolved.origin !== 'https://luxedrive.internal') return fallback;
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return fallback;
  }
}
