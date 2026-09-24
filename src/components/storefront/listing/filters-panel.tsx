'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/modules/core/money';
import type { FilterableAttribute } from '@/modules/catalog';
import type { Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { withQueryPatch } from '@/lib/query-string';
import { cn } from '@/lib/utils';

export interface FiltersPanelProps {
  locale: Locale;
  currency: string;
  brands: { id: string; slug: string; nameAr: string; nameEn: string }[];
  selectedBrandSlugs: string[];
  attributes: FilterableAttribute[];
  selectedAttributeFilters: Record<string, string[]>;
  priceRange: { minMinor: number; maxMinor: number } | null;
  selectedPriceMinMinor?: number;
  selectedPriceMaxMinor?: number;
  inStockOnly: boolean;
  className?: string;
}

/**
 * Every control here is a real navigation, not local-only UI state — a
 * filter is always reflected in the URL, so the result is shareable,
 * bookmarkable, and survives a refresh. Brand and attribute filters are
 * generic by construction: `attributes` comes from
 * `catalog.getFilterableAttributes(categoryId)`, so this component never
 * hardcodes what a filter is called or how many exist.
 */
export function FiltersPanel({
  locale,
  currency,
  brands,
  selectedBrandSlugs,
  attributes,
  selectedAttributeFilters,
  priceRange,
  selectedPriceMinMinor,
  selectedPriceMaxMinor,
  inStockOnly,
  className,
}: FiltersPanelProps) {
  // The desktop `<aside>` copy and the mobile `FiltersDrawer`'s copy of
  // this same component are both mounted at once (the aside is only
  // CSS-hidden, not unrendered) — a literal string id here would duplicate
  // across them, breaking every `<label for>` association's accessible
  // name (found via axe/keyboard e2e testing, P05). `useId()` gives each
  // instance its own unique, SSR-stable prefix.
  const instanceId = React.useId();
  const t = getDictionary(locale);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [priceMinDraft, setPriceMinDraft] = React.useState(
    selectedPriceMinMinor !== undefined ? String(Math.round(selectedPriceMinMinor / 100)) : '',
  );
  const [priceMaxDraft, setPriceMaxDraft] = React.useState(
    selectedPriceMaxMinor !== undefined ? String(Math.round(selectedPriceMaxMinor / 100)) : '',
  );

  const navigate = (patch: Record<string, string | string[] | undefined | null>) => {
    const query = withQueryPatch(searchParams, patch);
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const toggleBrand = (slug: string) => {
    const next = selectedBrandSlugs.includes(slug)
      ? selectedBrandSlugs.filter((s) => s !== slug)
      : [...selectedBrandSlugs, slug];
    navigate({ brand: next });
  };

  const toggleAttribute = (key: string, value: string) => {
    const current = selectedAttributeFilters[key] ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    navigate({ [`attr_${key}`]: next });
  };

  const applyPriceRange = () => {
    const minMajor = Number(priceMinDraft);
    const maxMajor = Number(priceMaxDraft);
    navigate({
      priceMin:
        priceMinDraft && Number.isFinite(minMajor) ? String(Math.round(minMajor * 100)) : undefined,
      priceMax:
        priceMaxDraft && Number.isFinite(maxMajor) ? String(Math.round(maxMajor * 100)) : undefined,
    });
  };

  const hasActiveFilters =
    selectedBrandSlugs.length > 0 ||
    Object.keys(selectedAttributeFilters).length > 0 ||
    selectedPriceMinMinor !== undefined ||
    selectedPriceMaxMinor !== undefined ||
    inStockOnly;

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <div className="flex items-center justify-between">
        <p className="text-h6 text-(--color-text)">{t.listing.filters}</p>
        {hasActiveFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              navigate({
                brand: undefined,
                priceMin: undefined,
                priceMax: undefined,
                inStock: undefined,
                ...Object.fromEntries(attributes.map((a) => [`attr_${a.key}`, undefined])),
              })
            }
          >
            {t.listing.clearFilters}
          </Button>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-label text-(--color-text-muted) uppercase">
          {t.listing.availability}
        </legend>
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${instanceId}-in-stock`}
            checked={inStockOnly}
            onCheckedChange={() => navigate({ inStock: inStockOnly ? undefined : '1' })}
          />
          <Label htmlFor={`${instanceId}-in-stock`} className="cursor-pointer text-sm font-normal">
            {t.listing.inStockOnly}
          </Label>
        </div>
      </fieldset>

      {priceRange ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-label text-(--color-text-muted) uppercase">
            {t.listing.price}
          </legend>
          <p className="text-caption text-(--color-text-muted)">
            {formatMoney(priceRange.minMinor, { currency, locale })} –{' '}
            {formatMoney(priceRange.maxMinor, { currency, locale })}
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              placeholder={t.listing.priceMin}
              aria-label={t.listing.priceMin}
              value={priceMinDraft}
              onChange={(e) => setPriceMinDraft(e.target.value)}
              onBlur={applyPriceRange}
              className="tabular-nums"
            />
            <Input
              type="number"
              inputMode="numeric"
              placeholder={t.listing.priceMax}
              aria-label={t.listing.priceMax}
              value={priceMaxDraft}
              onChange={(e) => setPriceMaxDraft(e.target.value)}
              onBlur={applyPriceRange}
              className="tabular-nums"
            />
          </div>
        </fieldset>
      ) : null}

      {brands.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-label text-(--color-text-muted) uppercase">
            {t.listing.brand}
          </legend>
          {brands.map((brand) => (
            <div key={brand.id} className="flex items-center gap-2">
              <Checkbox
                id={`${instanceId}-brand-${brand.slug}`}
                checked={selectedBrandSlugs.includes(brand.slug)}
                onCheckedChange={() => toggleBrand(brand.slug)}
              />
              <Label
                htmlFor={`${instanceId}-brand-${brand.slug}`}
                className="cursor-pointer text-sm font-normal"
              >
                {locale === 'ar' ? brand.nameAr : brand.nameEn}
              </Label>
            </div>
          ))}
        </fieldset>
      ) : null}

      {attributes.map((attribute) => (
        <fieldset key={attribute.key} className="flex flex-col gap-2">
          <legend className="mb-1 text-label text-(--color-text-muted) uppercase">
            {locale === 'ar' ? attribute.labelAr : attribute.labelEn}
          </legend>
          {attribute.allowedValues.map((value) => (
            <div key={value} className="flex items-center gap-2">
              <Checkbox
                id={`${instanceId}-${attribute.key}-${value}`}
                checked={(selectedAttributeFilters[attribute.key] ?? []).includes(value)}
                onCheckedChange={() => toggleAttribute(attribute.key, value)}
              />
              <Label
                htmlFor={`${instanceId}-${attribute.key}-${value}`}
                className="cursor-pointer text-sm font-normal"
              >
                {value}
              </Label>
            </div>
          ))}
        </fieldset>
      ))}
    </div>
  );
}
