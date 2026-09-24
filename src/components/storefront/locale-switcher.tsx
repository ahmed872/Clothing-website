'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Languages } from 'lucide-react';

import { localizePath, type Locale } from '@/lib/i18n/locales';
import { Button } from '@/components/ui/button';

export interface LocaleSwitcherProps {
  locale: Locale;
  /** The other locale's label, in that locale's own script — "English" /
   * "العربية" — so the switcher itself never needs its own dictionary
   * lookup. */
  label: string;
}

/** Swaps `/ar/...` for `/en/...` (or back), preserving the current path and
 * query string, and remembers the choice for the next bare-`/` visit —
 * `proxy.ts` reads the same cookie. A full navigation, not client-side
 * routing: crossing locales also crosses `[locale]/layout.tsx`'s `lang`/
 * `dir`, which a client-side transition can't repaint cleanly anyway. */
export function LocaleSwitcher({ locale, label }: LocaleSwitcherProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const otherLocale: Locale = locale === 'ar' ? 'en' : 'ar';
  const query = searchParams.toString();
  const href = localizePath(pathname, otherLocale) + (query ? `?${query}` : '');

  return (
    <Button asChild variant="ghost" size="sm" className="gap-1.5">
      <Link
        href={href}
        onClick={() => {
          try {
            document.cookie = `luxedrive-locale=${otherLocale};path=/;max-age=${60 * 60 * 24 * 365}`;
          } catch {
            // Cookies disabled — the navigation itself still works.
          }
        }}
      >
        <Languages className="size-4" aria-hidden="true" />
        {label}
      </Link>
    </Button>
  );
}
