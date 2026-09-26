'use client';

import type { ProductDetailOption, ProductDetailVariant } from '@/modules/catalog';
import { availableValuesForOption } from '@/lib/variant-selection';
import { cn } from '@/lib/utils';
import type { Locale } from '@/lib/i18n/locales';

export interface VariantSelectorProps {
  options: ProductDetailOption[];
  variants: ProductDetailVariant[];
  /** Option id → chosen value id. Owned by the caller (the purchase panel),
   * so something else on the page — a size recommendation's "select this
   * size" — can choose a value too, through the same state. */
  selection: Record<string, string>;
  onSelect: (optionId: string, valueId: string) => void;
  locale: Locale;
}

/** The option values of `variant`, keyed by option — the selection a page
 * opens on. */
export function selectionForVariant(
  options: ProductDetailOption[],
  variant: ProductDetailVariant | undefined,
): Record<string, string> {
  const selection: Record<string, string> = {};
  if (!variant) return selection;
  for (const option of options) {
    const match = option.values.find((v) => variant.optionValueIds.includes(v.id));
    if (match) selection[option.id] = match.id;
  }
  return selection;
}

/**
 * Generic by construction (P05 §7): built entirely from `ProductOption`/
 * `OptionValue` data — Color+Size for shoes, Storage+Color for electronics,
 * Trim for cars all render through the exact same component, because
 * nothing here ever asks what the product *is*. A product with no options
 * (`options.length === 0`) renders nothing — there's exactly one variant,
 * already selected.
 *
 * Controlled (clothing P02): it renders `selection` and reports clicks; the
 * variant that selection resolves to is the caller's to compute.
 */
export function VariantSelector({
  options,
  variants,
  selection,
  onSelect,
  locale,
}: VariantSelectorProps) {
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
                    onClick={() => onSelect(option.id, value.id)}
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
