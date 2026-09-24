'use client';

import { useState } from 'react';
import { Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { searchProductsForScopeAction, type ScopeOption } from '@/lib/admin/scope-search-actions';
import type { Locale } from '@/lib/i18n/locales';

export type ScopeKind = 'PRODUCT' | 'CATEGORY' | 'BRAND';

export interface ScopeSelection {
  scopeType: ScopeKind;
  targetId: string;
  label: string;
}

export interface ScopePickerLabels {
  scopeProducts: string;
  scopeCategories: string;
  scopeBrands: string;
  scopeSearchPlaceholder: string;
  scopeSearching: string;
  scopeNoResults: string;
  scopeAdd: string;
  scopeRemove: string;
  scopeSelected: string;
  scopeEmpty: string;
}

/**
 * Choosing what a promotion applies to.
 *
 * Products are searched on the server as the admin types and never arrive as
 * a full list — a catalog of ten thousand products cannot be shipped into a
 * form control (P09 §13). Categories and brands are small, bounded sets, so
 * the page hands them over once and this only filters what it already has.
 */
export function ScopePicker({
  value,
  onChange,
  locale,
  categories,
  brands,
  labels,
}: {
  value: ScopeSelection[];
  onChange: (next: ScopeSelection[]) => void;
  locale: Locale;
  categories: ScopeOption[];
  brands: ScopeOption[];
  labels: ScopePickerLabels;
}) {
  const [kind, setKind] = useState<ScopeKind>('CATEGORY');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScopeOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const kindLabel: Record<ScopeKind, string> = {
    PRODUCT: labels.scopeProducts,
    CATEGORY: labels.scopeCategories,
    BRAND: labels.scopeBrands,
  };

  function add(option: ScopeOption): void {
    if (value.some((s) => s.scopeType === kind && s.targetId === option.id)) return;
    onChange([...value, { scopeType: kind, targetId: option.id, label: option.label }]);
  }

  function remove(selection: ScopeSelection): void {
    onChange(
      value.filter(
        (s) => !(s.scopeType === selection.scopeType && s.targetId === selection.targetId),
      ),
    );
  }

  async function runSearch(): Promise<void> {
    if (kind !== 'PRODUCT') return;
    setSearching(true);
    setSearched(true);
    setResults(await searchProductsForScopeAction(query, locale));
    setSearching(false);
  }

  // Categories and brands are bounded, so they filter in place rather than
  // making a round trip per keystroke.
  const localOptions = (kind === 'CATEGORY' ? categories : brands).filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const options = kind === 'PRODUCT' ? results : localOptions;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="scope-kind" className="sr-only">
            {labels.scopeSelected}
          </Label>
          <Select
            value={kind}
            onValueChange={(next) => {
              setKind(next as ScopeKind);
              setQuery('');
              setResults([]);
              setSearched(false);
            }}
          >
            <SelectTrigger id="scope-kind">
              <SelectValue>{kindLabel[kind]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CATEGORY">{labels.scopeCategories}</SelectItem>
              <SelectItem value="BRAND">{labels.scopeBrands}</SelectItem>
              <SelectItem value="PRODUCT">{labels.scopeProducts}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2">
          <Input
            value={query}
            placeholder={labels.scopeSearchPlaceholder}
            aria-label={labels.scopeSearchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void runSearch();
              }
            }}
          />
          {kind === 'PRODUCT' ? (
            <Button type="button" variant="outline" onClick={() => void runSearch()}>
              <Search className="size-4" aria-hidden="true" />
              {searching ? labels.scopeSearching : labels.scopeAdd}
            </Button>
          ) : null}
        </div>
      </div>

      {options.length > 0 ? (
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-(--radius-surface) border border-(--color-border) p-2">
          {options.map((option) => (
            <li key={`${kind}:${option.id}`}>
              <button
                type="button"
                onClick={() => add(option)}
                className="flex w-full items-center justify-between gap-2 rounded-(--radius-control) px-2 py-1.5 text-start text-sm hover:bg-(--color-surface-raised)"
              >
                <span className="text-(--color-text)">{option.label}</span>
                {option.hint ? (
                  <span dir="ltr" className="text-caption text-(--color-text-muted) tabular-nums">
                    {option.hint}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {kind === 'PRODUCT' && searched && !searching && results.length === 0 ? (
        <p className="text-small text-(--color-text-muted)">{labels.scopeNoResults}</p>
      ) : null}

      <div className="flex flex-col gap-2">
        <p className="text-small font-medium text-(--color-text)">{labels.scopeSelected}</p>
        {value.length === 0 ? (
          <p className="text-small text-(--color-text-muted)">{labels.scopeEmpty}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {value.map((selection) => (
              <li
                key={`${selection.scopeType}:${selection.targetId}`}
                className="inline-flex items-center gap-1.5 rounded-(--radius-full) bg-(--color-secondary) py-1 ps-3 pe-1.5 text-xs font-medium text-(--color-secondary-foreground)"
              >
                <span className="text-(--color-text-muted)">{kindLabel[selection.scopeType]}</span>
                <span>{selection.label}</span>
                <button
                  type="button"
                  aria-label={labels.scopeRemove.replace('{label}', selection.label)}
                  onClick={() => remove(selection)}
                  className="flex size-4 items-center justify-center rounded-(--radius-full) hover:bg-(--color-secondary-hover)"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
