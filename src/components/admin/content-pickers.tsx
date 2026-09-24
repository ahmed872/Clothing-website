'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';

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
import {
  searchProductsForContentAction,
  type ContentPickerOption,
} from '@/lib/admin/content-actions';
import type { Locale } from '@/lib/i18n/locales';

/**
 * The two "which things does this section show" controls (P15).
 *
 * A curated rail stores product ids and a featured grid stores category
 * ids, and neither may be a raw-UUID text box: the whole point of the
 * Content screen is that a store owner builds their homepage without
 * knowing what a UUID is. Products are searched on the server as they type
 * (a catalog can be huge — the same constraint `scope-picker.tsx` solved
 * for promotions); categories are a small bounded tree the page hands over
 * whole.
 *
 * Order matters in both: the ids are stored in the order picked, and that
 * is the order the storefront renders. So the selected list is a reorderable
 * list with real buttons rather than drag-and-drop, which keyboard and
 * screen-reader users cannot operate.
 */

export interface ContentPickerLabels {
  searchPlaceholder: string;
  searchButton: string;
  searching: string;
  noResults: string;
  searchHint: string;
  add: string;
  remove: string;
  selected: string;
  moveUp: string;
  moveDown: string;
  notPublished: string;
  notPublishedHelp: string;
  categoryLabel: string;
}

function SelectedList({
  items,
  onChange,
  labels,
}: {
  items: ContentPickerOption[];
  onChange: (next: ContentPickerOption[]) => void;
  labels: ContentPickerLabels;
}) {
  function move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    onChange(next);
  }

  if (items.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1.5" aria-label={labels.selected}>
      {items.map((item, index) => (
        <li
          key={item.id}
          className="flex items-center gap-2 rounded-(--radius-control) border border-(--color-border) bg-(--color-surface) px-3 py-2"
        >
          <span className="w-6 shrink-0 text-caption tabular-nums text-(--color-text-subtle)">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-(--color-text)">{item.label}</span>
          {item.published ? null : (
            <span className="shrink-0 rounded-(--radius-control) bg-(--color-warning)/15 px-2 py-0.5 text-caption text-(--color-text)">
              {labels.notPublished}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${labels.moveUp} — ${item.label}`}
            disabled={index === 0}
            onClick={() => move(index, -1)}
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${labels.moveDown} — ${item.label}`}
            disabled={index === items.length - 1}
            onClick={() => move(index, 1)}
          >
            <ArrowDown className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${labels.remove} — ${item.label}`}
            onClick={() => onChange(items.filter((candidate) => candidate.id !== item.id))}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function ContentProductPicker({
  value,
  onChange,
  locale,
  labels,
  fieldLabel,
  error,
}: {
  value: ContentPickerOption[];
  onChange: (next: ContentPickerOption[]) => void;
  locale: Locale;
  labels: ContentPickerLabels;
  fieldLabel: string;
  error?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ContentPickerOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  async function runSearch(): Promise<void> {
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      setResults(await searchProductsForContentAction(query, locale));
      setSearched(true);
    } finally {
      setSearching(false);
    }
  }

  const anyUnpublished = value.some((item) => !item.published);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="content-product-search">{fieldLabel}</Label>
        <div className="flex gap-2">
          <Input
            id="content-product-search"
            value={query}
            placeholder={labels.searchPlaceholder}
            aria-describedby="content-product-search-help"
            onChange={(event) => setQuery(event.target.value)}
            // A form-wide Enter would submit the section instead of
            // searching, which is never what a half-typed query means.
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              void runSearch();
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={labels.searchButton}
            onClick={() => void runSearch()}
            loading={searching}
            disabled={query.trim().length < 2}
          >
            <Search aria-hidden="true" />
          </Button>
        </div>
        <p id="content-product-search-help" className="text-caption text-(--color-text-muted)">
          {labels.searchHint}
        </p>
      </div>

      {searched && !searching ? (
        results.length === 0 ? (
          <p className="text-small text-(--color-text-muted)">{labels.noResults}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {results.map((option) => {
              const already = value.some((item) => item.id === option.id);
              return (
                <li key={option.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-(--color-text)">
                    {option.label}
                    {option.hint ? (
                      <span className="text-(--color-text-subtle)" dir="ltr">
                        {' '}
                        · {option.hint}
                      </span>
                    ) : null}
                  </span>
                  {option.published ? null : (
                    <span className="shrink-0 rounded-(--radius-control) bg-(--color-warning)/15 px-2 py-0.5 text-caption text-(--color-text)">
                      {labels.notPublished}
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={already}
                    onClick={() => onChange([...value, option])}
                  >
                    {labels.add}
                  </Button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      <SelectedList items={value} onChange={onChange} labels={labels} />

      {anyUnpublished ? (
        <p className="text-small text-(--color-text-muted)">{labels.notPublishedHelp}</p>
      ) : null}

      {error ? (
        <p role="alert" className="text-small text-(--color-error)">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ContentCategoryPicker({
  value,
  onChange,
  options,
  labels,
  fieldLabel,
  error,
}: {
  value: ContentPickerOption[];
  onChange: (next: ContentPickerOption[]) => void;
  options: ContentPickerOption[];
  labels: ContentPickerLabels;
  fieldLabel: string;
  error?: string;
}) {
  const [pending, setPending] = useState('');
  const available = options.filter((option) => !value.some((item) => item.id === option.id));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label id="content-category-picker-label">{fieldLabel}</Label>
        <div className="flex gap-2">
          <Select value={pending} onValueChange={setPending}>
            <SelectTrigger aria-labelledby="content-category-picker-label" className="flex-1">
              <SelectValue placeholder={labels.categoryLabel} />
            </SelectTrigger>
            <SelectContent>
              {available.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            disabled={!pending}
            onClick={() => {
              const option = options.find((candidate) => candidate.id === pending);
              if (!option) return;
              onChange([...value, option]);
              setPending('');
            }}
          >
            {labels.add}
          </Button>
        </div>
      </div>

      <SelectedList items={value} onChange={onChange} labels={labels} />

      {error ? (
        <p role="alert" className="text-small text-(--color-error)">
          {error}
        </p>
      ) : null}
    </div>
  );
}
