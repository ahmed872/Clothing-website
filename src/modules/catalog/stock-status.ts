import type { Variant } from '@generated/prisma';

/** Shared between the listing grid (an aggregate across a product's
 * variants) and the product page (one variant at a time) so a card and its
 * own detail page can never disagree about whether something is in stock. */
export type StockStatus = 'in-stock' | 'low-stock' | 'out-of-stock';

export function resolveVariantStockStatus(
  variant: Pick<Variant, 'trackInventory' | 'stockQuantity' | 'lowStockThreshold'>,
): StockStatus {
  if (!variant.trackInventory) return 'in-stock';
  if (variant.stockQuantity <= 0) return 'out-of-stock';
  if (variant.stockQuantity <= variant.lowStockThreshold) return 'low-stock';
  return 'in-stock';
}
