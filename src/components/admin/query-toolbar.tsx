'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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

/**
 * The filter bar for the P08 list screens, driven entirely by the URL.
 *
 * The page that renders it is a Server Component that reads `searchParams`
 * and filters, sorts and paginates in SQL — nothing here filters rows, and
 * no screen ever receives more rows than the page it is showing (P08 §10).
 * Keeping the state in the URL also makes a filtered view shareable and the
 * back button correct, for free.
 *
 * Config-driven rather than one bespoke toolbar per screen: inventory,
 * inventory history and pricing differ only in which filters they offer.
 */

export interface QueryToolbarOption {
  value: string;
  label: string;
}

export interface QueryToolbarSelect {
  key: string;
  label: string;
  options: QueryToolbarOption[];
  /** Sorts have no "all" — one option is always in effect. */
  includeAll?: boolean;
  /**
   * Which option is in effect when the URL carries no value for this key.
   * Only meaningful with `includeAll: false`, where *something* is always
   * selected.
   *
   * Without it the control falls back to the first option, which is right
   * only as long as the page's own default happens to be listed first —
   * a coupling that is invisible at the call site and silently makes the
   * control report a state the server did not use (and, because the value
   * never changes, makes selecting that option do nothing at all). Pass the
   * page's real default and the two cannot drift.
   */
  defaultValue?: string;
}

export interface QueryToolbarDate {
  key: string;
  label: string;
}

export interface QueryToolbarLabels {
  allOption: string;
  clearAll: string;
  removeFilter: string;
}

const ALL = '__all__';

export function QueryToolbar({
  searchKey,
  searchPlaceholder,
  selects = [],
  dates = [],
  labels,
}: {
  searchKey?: string;
  searchPlaceholder?: string;
  selects?: QueryToolbarSelect[];
  dates?: QueryToolbarDate[];
  labels: QueryToolbarLabels;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [query, setQuery] = useState(searchKey ? (searchParams.get(searchKey) ?? '') : '');

  function apply(changes: Record<string, string | null>): void {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '' || value === ALL) params.delete(key);
      else params.set(key, value);
    }
    // Any filter change invalidates the page number: page 7 of the old
    // result set is meaningless, and usually empty, in the new one.
    if (!('page' in changes)) params.delete('page');

    const search = params.toString();
    startTransition(() => router.push(search ? `${pathname}?${search}` : pathname));
  }

  function labelFor(options: QueryToolbarOption[], value: string): string {
    return options.find((option) => option.value === value)?.label ?? value;
  }

  const activeFilters: ActiveFilter[] = [];
  if (searchKey) {
    const value = searchParams.get(searchKey);
    if (value) activeFilters.push({ key: searchKey, label: `“${value}”` });
  }
  for (const select of selects) {
    if (select.includeAll === false) continue;
    const value = searchParams.get(select.key);
    if (value) activeFilters.push({ key: select.key, label: labelFor(select.options, value) });
  }
  for (const date of dates) {
    const value = searchParams.get(date.key);
    if (value) activeFilters.push({ key: date.key, label: `${date.label}: ${value}` });
  }

  return (
    <FilterBar
      activeFilters={activeFilters}
      onRemoveFilter={(key) => {
        if (key === searchKey) setQuery('');
        apply({ [key]: null });
      }}
      onClearAll={() => {
        setQuery('');
        startTransition(() => router.push(pathname));
      }}
      clearAllLabel={labels.clearAll}
      removeFilterLabel={(label) => labels.removeFilter.replace('{label}', label)}
    >
      {searchKey ? (
        <form
          className="w-full sm:w-72"
          onSubmit={(event) => {
            event.preventDefault();
            apply({ [searchKey]: query });
          }}
        >
          <AdminSearch
            value={query}
            onChange={(value) => {
              setQuery(value);
              // Emptying the box is itself a filter change, and there is no
              // "submit" gesture for "show me everything again".
              if (value === '') apply({ [searchKey]: null });
            }}
            placeholder={searchPlaceholder}
          />
        </form>
      ) : null}

      {selects.map((select) => {
        const includeAll = select.includeAll !== false;
        const fallback = includeAll ? ALL : (select.defaultValue ?? select.options[0]?.value);
        const current = searchParams.get(select.key) ?? fallback;
        const currentLabel = current && current !== ALL ? labelFor(select.options, current) : null;
        return (
          <div key={select.key} className="flex min-w-40 flex-col gap-1">
            <label htmlFor={`filter-${select.key}`} className="sr-only">
              {select.label}
            </label>
            <Select value={current} onValueChange={(value) => apply({ [select.key]: value })}>
              <SelectTrigger id={`filter-${select.key}`} aria-label={select.label}>
                <SelectValue>{currentLabel ?? select.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {includeAll ? <SelectItem value={ALL}>{labels.allOption}</SelectItem> : null}
                {select.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}

      {dates.map((date) => (
        <div key={date.key} className="flex flex-col gap-1">
          <label htmlFor={`filter-${date.key}`} className="sr-only">
            {date.label}
          </label>
          <Input
            id={`filter-${date.key}`}
            type="date"
            // A date input's value is always ISO `YYYY-MM-DD`, one LTR run,
            // whatever the surrounding direction is.
            dir="ltr"
            defaultValue={searchParams.get(date.key) ?? ''}
            onChange={(event) => apply({ [date.key]: event.target.value || null })}
            aria-label={date.label}
            title={date.label}
            className="w-40 tabular-nums"
          />
        </div>
      ))}
    </FilterBar>
  );
}
