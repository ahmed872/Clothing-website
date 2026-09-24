'use client';

import * as React from 'react';

import type { ProductDetailOption, ProductDetailVariant } from '@/modules/catalog';
import { availableValuesForOption, findMatchingVariant } from '@/lib/variant-selection';
import { cn } from '@/lib/utils';
import type { Locale } from '@/lib/i18n/locales';

export interface VariantSelectorProps {
  options: ProductDetailOption[];
  variants: ProductDetailVariant[];
  defaultVariantId: string;
  locale: Locale;
  onVariantChange: (variant: ProductDetailVariant | undefined) => void;
}

/**
 * Generic by construction (P05 §7): built entirely from `ProductOption`/
 * `OptionValue` data — Color+Size for shoes, Storage+Color for electronics,
 * Trim for cars all render through the exact same component, because
 * nothing here ever asks what the product *is*. A product with no options
 * (`options.length === 0`, the common case for this catalog's cars) renders
 * nothing — there's exactly one variant, already selected.
 */
export function VariantSelector({
  options,
  variants,
  defaultVariantId,
  locale,
  onVariantChange,
}: VariantSelectorProps) {
  const defaultVariant = variants.find((v) => v.id === defaultVariantId);
  const initialSelection = React.useMemo(() => {
    const selection: Record<string, string> = {};
    if (!defaultVariant) return selection;
    for (const option of options) {
      const match = option.values.find((v) => defaultVariant.optionValueIds.includes(v.id));
      if (match) selection[option.id] = match.id;
    }
    return selection;
  }, [defaultVariant, options]);

  const [selection, setSelection] = React.useState<Record<string, string>>(initialSelection);

  React.useEffect(() => {
    const matched = findMatchingVariant(variants, selection);
    onVariantChange(matched);
    // Only re-resolve when the selection itself changes — `variants` and
    // `onVariantChange` are stable for the life of this component instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  if (options.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {options.map((option) => {
        const availableIds = availableValuesForOption(
          variants,
          option.id,
          option.values.map((v) => v.id),
          selection,
        );
        const selectedValueId = selection[option.id];
        const selectedValue = option.values.find((v) => v.id === selectedValueId);

        return (
          <div key={option.id} className="flex flex-col gap-2">
            <p className="text-sm font-medium text-(--color-text)">
              {locale === 'ar' ? option.nameAr : option.nameEn}
              {selectedValue ? (
                <span className="ms-1.5 font-normal text-(--color-text-muted)">
                  {locale === 'ar' ? selectedValue.valueAr : selectedValue.valueEn}
                </span>
              ) : null}
            </p>
            <div
              role="radiogroup"
              aria-label={locale === 'ar' ? option.nameAr : option.nameEn}
              className="flex flex-wrap gap-2"
            >
              {option.values.map((value) => {
                const isSelected = selectedValueId === value.id;
                const isAvailable = availableIds.has(value.id);
                return (
                  <button
                    key={value.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={!isAvailable}
                    onClick={() => setSelection((prev) => ({ ...prev, [option.id]: value.id }))}
                    className={cn(
                      'min-w-11 rounded-(--radius-control) border px-3 py-2 text-sm font-medium outline-none',
                      'transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-(--color-ring)/25',
                      isSelected
                        ? 'border-(--color-primary) bg-(--color-primary) text-(--color-primary-foreground)'
                        : 'border-(--color-border) bg-(--color-surface) text-(--color-text) hover:bg-(--color-surface-raised)',
                      !isAvailable && 'cursor-not-allowed opacity-40',
                    )}
                  >
                    {locale === 'ar' ? value.valueAr : value.valueEn}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
