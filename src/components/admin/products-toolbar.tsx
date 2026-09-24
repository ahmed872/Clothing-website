'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState, useTransition } from 'react';

import { AdminSearch } from '@/components/admin/search';
import { FilterBar, type ActiveFilter } from '@/components/admin/filters';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface ProductsToolbarOption {
  value: string;
  label: string;
}

export interface ProductsToolbarLabels {
  searchPlaceholder: string;
  filterStatus: string;
  filterCategory: string;
  filterBrand: string;
  filterStock: string;
  filterPriceMin: string;
  filterPriceMax: string;
  allOption: string;
  sort: string;
  clearAll: string;
  removeFilter: string;
}

export interface ProductsToolbarProps {
  labels: ProductsToolbarLabels;
  statusOptions: ProductsToolbarOption[];
  categoryOptions: ProductsToolbarOption[];
  brandOptions: ProductsToolbarOption[];
  stockOptions: ProductsToolbarOption[];
  sortOptions: ProductsToolbarOption[];
}

const ALL = '__all__';

/**
 * Every filter lives in the URL, never in component state: the page is a
 * Server Component that reads `searchParams` and does the filtering in SQL
 * (P07 §20 — never ship the whole catalog to the browser to filter it
 * there). That also makes a filtered list a shareable, bookmarkable,
 * back-button-correct URL for free.
 */
export function ProductsToolbar({
  labels,
  statusOptions,
  categoryOptions,
  brandOptions,
  stockOptions,
  sortOptions,
}: ProductsToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [priceMin, setPriceMin] = useState(searchParams.get('priceMin') ?? '');
  const [priceMax, setPriceMax] = useState(searchParams.get('priceMax') ?? '');

  function apply(changes: Record<string, string | null>): void {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '' || value === ALL) params.delete(key);
      else params.set(key, value);
    }
    // Any filter change invalidates the current page number — page 7 of the
    // old result set is meaningless (often empty) in the new one.
    if (!('page' in changes)) params.delete('page');

    const search = params.toString();
    startTransition(() => router.push(search ? `${pathname}?${search}` : pathname));
  }

  function labelFor(options: ProductsToolbarOption[], value: string): string {
    return options.find((option) => option.value === value)?.label ?? value;
  }

  const activeFilters: ActiveFilter[] = [];
  const queryParam = searchParams.get('q');
  if (queryParam) activeFilters.push({ key: 'q', label: `“${queryParam}”` });
  for (const [key, options] of [
    ['status', statusOptions],
    ['categoryId', categoryOptions],
    ['brandId', brandOptions],
    ['stock', stockOptions],
  ] as const) {
    const value = searchParams.get(key);
    if (value) activeFilters.push({ key, label: labelFor(options, value) });
  }
  const priceMinParam = searchParams.get('priceMin');
  const priceMaxParam = searchParams.get('priceMax');
  if (priceMinParam) {
    activeFilters.push({ key: 'priceMin', label: `${labels.filterPriceMin}: ${priceMinParam}` });
  }
  if (priceMaxParam) {
    activeFilters.push({ key: 'priceMax', label: `${labels.filterPriceMax}: ${priceMaxParam}` });
  }

  const selectFilters: {
    key: string;
    label: string;
    options: ProductsToolbarOption[];
    includeAll: boolean;
  }[] = [
    { key: 'status', label: labels.filterStatus, options: statusOptions, includeAll: true },
    { key: 'categoryId', label: labels.filterCategory, options: categoryOptions, includeAll: true },
    { key: 'brandId', label: labels.filterBrand, options: brandOptions, includeAll: true },
    { key: 'stock', label: labels.filterStock, options: stockOptions, includeAll: true },
    { key: 'sort', label: labels.sort, options: sortOptions, includeAll: false },
  ];

  return (
    <FilterBar
      activeFilters={activeFilters}
      onRemoveFilter={(key) => {
        if (key === 'priceMin') setPriceMin('');
        if (key === 'priceMax') setPriceMax('');
        if (key === 'q') setQuery('');
        apply({ [key]: null });
      }}
      onClearAll={() => {
        setQuery('');
        setPriceMin('');
        setPriceMax('');
        startTransition(() => router.push(pathname));
      }}
      clearAllLabel={labels.clearAll}
      removeFilterLabel={(label) => labels.removeFilter.replace('{label}', label)}
    >
      <form
        className="w-full sm:w-72"
        onSubmit={(event) => {
          event.preventDefault();
          apply({ q: query });
        }}
      >
        <AdminSearch
          value={query}
          onChange={(value) => {
            setQuery(value);
            // Clearing the box is a filter change in itself — applied
            // immediately, since there is no "submit" gesture for "show me
            // everything again".
            if (value === '') apply({ q: null });
          }}
          placeholder={labels.searchPlaceholder}
        />
      </form>

      {selectFilters.map((filter) => {
        const current = searchParams.get(filter.key) ?? (filter.includeAll ? ALL : undefined);
        const currentLabel = current && current !== ALL ? labelFor(filter.options, current) : null;
        return (
          <div key={filter.key} className="flex min-w-40 flex-col gap-1">
            <label htmlFor={`filter-${filter.key}`} className="sr-only">
              {filter.label}
            </label>
            <Select
              value={current ?? filter.options[0]?.value}
              onValueChange={(value) => apply({ [filter.key]: value })}
            >
              <SelectTrigger id={`filter-${filter.key}`} aria-label={filter.label}>
                <SelectValue>
                  {currentLabel ?? (filter.includeAll ? filter.label : filter.options[0]?.label)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {filter.includeAll ? <SelectItem value={ALL}>{labels.allOption}</SelectItem> : null}
                {filter.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          apply({ priceMin: priceMin || null, priceMax: priceMax || null });
        }}
      >
        <Input
          type="number"
          min={0}
          inputMode="numeric"
          value={priceMin}
          onChange={(event) => setPriceMin(event.target.value)}
          onBlur={() => apply({ priceMin: priceMin || null })}
          placeholder={labels.filterPriceMin}
          aria-label={labels.filterPriceMin}
          className="w-28 tabular-nums"
        />
        <Input
          type="number"
          min={0}
          inputMode="numeric"
          value={priceMax}
          onChange={(event) => setPriceMax(event.target.value)}
          onBlur={() => apply({ priceMax: priceMax || null })}
          placeholder={labels.filterPriceMax}
          aria-label={labels.filterPriceMax}
          className="w-28 tabular-nums"
        />
      </form>
    </FilterBar>
  );
}
