'use client';

import { useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { LOCALE_COOKIE_NAME, directionForLocale, type Locale } from '@/lib/i18n/locales';

export interface AdminLocaleToggleProps {
  locale: Locale;
  /** The other locale's own name, in its own script — matches
   * `LocaleSwitcher`'s storefront convention. */
  label: string;
}

/**
 * Unlike the storefront (a separate `/ar`/`/en` URL per locale),
 * `/admin` has one URL per page in both languages — so switching language
 * here means "re-render this same page in the other language," not
 * "navigate elsewhere." The root layout reads `lang`/`dir` from the cookie
 * on every request, so updating the cookie and refreshing gets a fully
 * correct server-rendered page in the new language (dictionary strings,
 * `dir`, everything) — the same durability the storefront's cookie-first
 * approach gives, without needing a second URL space to maintain.
 */
export function AdminLocaleToggle({ locale, label }: AdminLocaleToggleProps) {
  const router = useRouter();
  const otherLocale: Locale = locale === 'ar' ? 'en' : 'ar';

  const switchLocale = () => {
    try {
      document.cookie = `${LOCALE_COOKIE_NAME}=${otherLocale};path=/;max-age=${60 * 60 * 24 * 365}`;
    } catch {
      // Cookies disabled — the immediate DOM update below still applies for this load.
    }
    document.documentElement.lang = otherLocale;
    document.documentElement.dir = directionForLocale(otherLocale);
    router.refresh();
  };

  return (
    <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={switchLocale}>
      <Languages className="size-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
