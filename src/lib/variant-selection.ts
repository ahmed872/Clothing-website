/**
 * Generic variant resolution — pure data matching, no module imports (kept
 * dependency-free so it's safe to import from a `'use client'` component
 * without pulling `@/modules/catalog`'s server-only pieces into the browser
 * bundle; see `product-price.tsx` for the same rule applied to `core/money`).
 *
 * "Generic" is the whole point (P05 §7): a shoe's Color+Size, a phone's
 * Storage+Color, a car's Trim are all just "a set of option ids per
 * variant" here — nothing branches on what kind of product it is.
 */

export interface SelectableOption {
  id: string;
  values: { id: string }[];
}

export interface SelectableVariant {
  id: string;
  optionValueIds: string[];
}

/** The variant whose `optionValueIds` set exactly matches `selection`
 * (order-independent), or `undefined` if the current selection doesn't
 * correspond to any real variant — which the UI should treat as "this
 * combination isn't available," not throw on. */
export function findMatchingVariant<V extends SelectableVariant>(
  variants: readonly V[],
  selection: Record<string, string>,
): V | undefined {
  const selectedIds = new Set(Object.values(selection));
  return variants.find((variant) => {
    if (variant.optionValueIds.length !== selectedIds.size) return false;
    return variant.optionValueIds.every((id) => selectedIds.has(id));
  });
}

/** For a given option, which of its values still lead to *some* variant
 * given the choices already made on every other option — the basis for
 * disabling a value combination that doesn't exist rather than only
 * discovering that after the fact. */
export function availableValuesForOption<V extends SelectableVariant>(
  variants: readonly V[],
  optionId: string,
  optionValueIdsForOption: readonly string[],
  currentSelection: Record<string, string>,
): Set<string> {
  const available = new Set<string>();
  for (const valueId of optionValueIdsForOption) {
    const candidateSelection = { ...currentSelection, [optionId]: valueId };
    const candidateIds = new Set(Object.values(candidateSelection));
    const matches = variants.some((variant) => {
      if (variant.optionValueIds.length < candidateIds.size) return false;
      return [...candidateIds].every((id) => variant.optionValueIds.includes(id));
    });
    if (matches) available.add(valueId);
  }
  return available;
}
