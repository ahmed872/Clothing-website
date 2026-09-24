import Link from 'next/link';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import type { Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';

export interface BreadcrumbTrailItem {
  label: string;
  href?: string;
}

export function StorefrontBreadcrumbs({
  locale,
  trail,
}: {
  locale: Locale;
  trail: BreadcrumbTrailItem[];
}) {
  const t = getDictionary(locale);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href={`/${locale}`}>{t.breadcrumb.home}</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {trail.map((item, index) => {
          const isLast = index === trail.length - 1;
          return (
            <li key={index} className="flex items-center gap-1.5">
              <BreadcrumbSeparator />
              {isLast || !item.href ? (
                <BreadcrumbPage>{item.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link href={item.href}>{item.label}</Link>
                </BreadcrumbLink>
              )}
            </li>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
