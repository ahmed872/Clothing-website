import Link from 'next/link';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

export interface AdminBreadcrumbTrailItem {
  label: string;
  href?: string;
}

export interface AdminBreadcrumbsProps {
  dashboardLabel: string;
  trail: AdminBreadcrumbTrailItem[];
}

/** Same composition `StorefrontBreadcrumbs` uses over the P02 `Breadcrumb`
 * primitives — "Dashboard" instead of "Home" as the one fixed root, since
 * `/admin` has no separate home/category hierarchy. */
export function AdminBreadcrumbs({ dashboardLabel, trail }: AdminBreadcrumbsProps) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {trail.length === 0 ? (
            <BreadcrumbPage>{dashboardLabel}</BreadcrumbPage>
          ) : (
            <BreadcrumbLink asChild>
              <Link href="/admin">{dashboardLabel}</Link>
            </BreadcrumbLink>
          )}
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
