'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { Locale } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';

export interface AccountNavLabels {
  navOverview: string;
  navProfile: string;
  navOrders: string;
}

/**
 * A row of links, not an admin-style sidebar (P12 §20's "no generic SaaS
 * dashboard") — three destinations is not enough content to justify a
 * persistent rail, and the storefront's own header already anchors the
 * page. Active state comes from the real URL (`usePathname`), so it stays
 * correct through a plain navigation with no client state to get out of
 * sync.
 */
export function AccountNav({ locale, labels }: { locale: Locale; labels: AccountNavLabels }) {
  const pathname = usePathname();

  const links = [
    { href: `/${locale}/account`, label: labels.navOverview },
    { href: `/${locale}/account/profile`, label: labels.navProfile },
    { href: `/${locale}/account/orders`, label: labels.navOrders },
  ];

  return (
    <nav aria-label={labels.navOverview} className="flex gap-1 border-b border-(--color-border)">
      {links.map((link) => {
        const active =
          link.href === `/${locale}/account`
            ? pathname === link.href
            : pathname === link.href || pathname?.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'border-b-2 px-3 py-2.5 text-small font-medium transition-colors duration-(--duration-fast)',
              active
                ? 'border-(--color-primary) text-(--color-text)'
                : 'border-transparent text-(--color-text-muted) hover:text-(--color-text)',
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
