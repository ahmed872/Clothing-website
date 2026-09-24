'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Pagination } from '@/components/ui/pagination';
import { withQueryPatch } from '@/lib/query-string';
import type { Locale } from '@/lib/i18n/locales';

export function PaginationNav({
  locale,
  page,
  pageCount,
}: {
  locale: Locale;
  page: number;
  pageCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (pageCount <= 1) return null;

  return (
    <Pagination
      page={page}
      pageCount={pageCount}
      onPageChange={(next) => {
        const query = withQueryPatch(searchParams, { page: next === 1 ? undefined : String(next) });
        router.push(query ? `${pathname}?${query}` : pathname);
      }}
      labels={
        locale === 'en'
          ? { previous: 'Previous', next: 'Next', page: (n) => `Page ${n}` }
          : undefined
      }
    />
  );
}
