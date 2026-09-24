/**
 * What a visitor reads for an attribute's stored value — its label in
 * `locale` when the attribute definition has one, otherwise the value as it
 * was typed. The value itself is never translated in storage: it is what
 * products keep and filter URLs carry, so this is display only.
 *
 * Dependency-free (a structural type, not `@/modules/catalog`'s) so a
 * `'use client'` component can import it without pulling server-only catalog
 * code into the browser bundle — the same rule `variant-selection.ts` follows.
 */

export type ValueLabels = Record<string, { ar?: string; en?: string }> | null | undefined;

export function attributeValueLabel(
  labels: ValueLabels,
  value: string,
  locale: 'ar' | 'en',
): string {
  return labels?.[value]?.[locale] ?? value;
}
