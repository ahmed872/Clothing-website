import Link from 'next/link';

import { cn } from '@/lib/utils';
import type { Locale } from '@/lib/i18n/locales';

export interface NavCategory {
  slug: string;
  nameAr: string;
  nameEn: string;
}

export interface NavLinksProps {
  locale: Locale;
  categories: NavCategory[];
  className?: string;
  onNavigate?: () => void;
}

/** Top-level category links — generic by construction: whatever categories
 * exist at the root of the tree become nav items, nothing hardcodes what
 * they're called or how many there are. */
export function NavLinks({ locale, categories, className, onNavigate }: NavLinksProps) {
  return (
    <nav className={cn('flex items-center gap-1', className)}>
      {categories.map((category) => (
        <Link
          key={category.slug}
          href={`/${locale}/c/${category.slug}`}
          onClick={onNavigate}
          className="rounded-(--radius-sm) px-3 py-2 text-sm font-medium text-(--color-text-muted) transition-colors duration-(--duration-fast) hover:bg-(--color-surface-raised) hover:text-(--color-text) focus-visible:ring-2 focus-visible:ring-(--color-ring)/25 outline-none"
        >
          {locale === 'ar' ? category.nameAr : category.nameEn}
        </Link>
      ))}
    </nav>
  );
}
