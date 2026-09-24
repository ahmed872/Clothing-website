'use server';

import { revalidatePath } from 'next/cache';

import { adminErrorMessage } from '@/lib/admin/admin-error-message';
import { revalidateStorefrontForProduct } from '@/lib/admin/revalidate-storefront';
import { requirePermission, recordAuditEvent } from '@/modules/identity';
import {
  applyBulkPrice,
  previewBulkPrice,
  productsForVariants,
  updateVariant,
  type BulkPriceOperation,
  type BulkPriceRow,
} from '@/modules/catalog';
import type { Locale } from '@/lib/i18n/locales';
import type { ActionResult } from '@/lib/admin/action-result';

/**
 * Variant prices, one at a time and in bulk.
 *
 * `products.update` — a price is a product field, and P06's permission set
 * has no separate pricing permission. STAFF can read prices and adjust
 * stock but cannot change what anything costs, which is the intended split.
 *
 * The preview is computed here, on the server, by the same function that
 * performs the write: an admin who confirms "1,050.00 → 1,102.50" gets
 * exactly that, and a browser that posts back different numbers cannot make
 * them land — `applyBulkPrice` recomputes from the stored price inside its
 * own transaction and ignores whatever the preview said.
 */

async function revalidateForVariants(variantIds: string[]): Promise<void> {
  const products = await productsForVariants(variantIds);
  for (const product of products) {
    revalidatePath(`/admin/products/${product.id}`);
    await revalidateStorefrontForProduct(product);
  }
  revalidatePath('/admin/pricing');
  revalidatePath('/admin/products');
}

export async function updateVariantPriceAction(
  variantId: string,
  input: { priceMinor: number; compareAtMinor: number | null },
  expectedUpdatedAt: string | null,
  locale: Locale,
): Promise<ActionResult<{ updatedAt: string }>> {
  try {
    const user = await requirePermission('products.update');
    const variant = await updateVariant(
      variantId,
      input,
      expectedUpdatedAt ? new Date(expectedUpdatedAt) : undefined,
    );

    await recordAuditEvent({
      action: 'price.updated',
      entityType: 'Variant',
      userId: user.id,
      entityId: variantId,
      after: { priceMinor: variant.priceMinor, compareAtMinor: variant.compareAtMinor },
    });

    await revalidateForVariants([variantId]);
    return { ok: true, data: { updatedAt: variant.updatedAt.toISOString() } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export interface BulkPricePreviewData {
  rows: BulkPriceRow[];
  blockedCount: number;
}

/** What the change would do. Reads only — nothing is written until the
 * admin confirms, and confirming recomputes rather than replaying this. */
export async function previewBulkPriceAction(
  variantIds: string[],
  operation: BulkPriceOperation,
  locale: Locale,
): Promise<ActionResult<BulkPricePreviewData>> {
  try {
    await requirePermission('products.update');
    const preview = await previewBulkPrice({ variantIds, operation });
    return { ok: true, data: preview };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function applyBulkPriceAction(
  variantIds: string[],
  operation: BulkPriceOperation,
  locale: Locale,
): Promise<ActionResult<{ updated: number }>> {
  try {
    const user = await requirePermission('products.update');
    const result = await applyBulkPrice({ variantIds, operation });

    // One event per variant, not one for the batch: a bulk change is still
    // N price changes, and "what happened to this SKU" has to be answerable
    // by filtering the log on that variant. Each entry carries the shared
    // operation, so the batch is still recoverable from the individual
    // rows. A single batch-wide event would have no entity id to file
    // itself under — `recordAuditEvent` would fall back to the actor's id,
    // which reads as an event about a user.
    for (const row of result.rows) {
      await recordAuditEvent({
        action: 'price.bulk_updated',
        entityType: 'Variant',
        userId: user.id,
        entityId: row.variantId,
        before: { priceMinor: row.currentPriceMinor },
        after: { priceMinor: row.newPriceMinor, operation },
      });
    }

    await revalidateForVariants(variantIds);
    return { ok: true, data: { updated: result.updated } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}
