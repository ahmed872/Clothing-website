'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { withQueryPatch } from '@/lib/query-string';
import type { SearchSort } from '@/modules/search';
import type { Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';

const SORT_OPTIONS: SearchSort[] = ['featured', 'newest', 'price-asc', 'price-desc'];

export function SortSelect({ locale, value }: { locale: Locale; value: SearchSort }) {
  const t = getDictionary(locale);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const labels: Record<SearchSort, string> = {
    relevance: t.listing.sortFeatured,
    featured: t.listing.sortFeatured,
    newest: t.listing.sortNewest,
    'price-asc': t.listing.sortPriceAsc,
    'price-desc': t.listing.sortPriceDesc,
  };

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const query = withQueryPatch(searchParams, { sort: next });
        router.push(query ? `${pathname}?${query}` : pathname);
      }}
    >
      <SelectTrigger aria-label={t.listing.sort} className="w-full sm:w-48">
        <SelectValue>{labels[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {SORT_OPTIONS.map((option) => (
          <SelectItem key={option} value={option}>
            {labels[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
