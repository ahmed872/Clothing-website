'use server';

import { revalidatePath } from 'next/cache';

import { adminErrorMessage } from '@/lib/admin/admin-error-message';
import { revalidateStorefrontForProduct } from '@/lib/admin/revalidate-storefront';
import { requirePermission, recordAuditEvent } from '@/modules/identity';
import { productsForVariants } from '@/modules/catalog';
import { adjustStock, setInventoryPolicy, type ManualInventoryReason } from '@/modules/inventory';
import type { Locale } from '@/lib/i18n/locales';
import type { ActionResult } from '@/lib/admin/action-result';

/**
 * Stock movements and per-variant inventory policy.
 *
 * `inventory.adjust` — the permission P06 already defines for exactly this,
 * held by STAFF upward. There is no second authorization mechanism here:
 * the same `requirePermission` every other admin action uses, checked on the
 * server on every call, whether or not the button that calls it was rendered.
 *
 * The variant id arrives from the client, so it is never trusted as
 * authorization — it is a lookup key, and `adjustStock` throws `NOT_FOUND`
 * for one that does not exist. What guards the write is the permission, not
 * possession of the id.
 *
 * Nothing here computes a new quantity: the action passes the admin's
 * intent (a delta, or an exact count) to the service, which resolves it
 * against the row it holds a lock on. A number computed here would be
 * computed from a page that may already be stale.
 */

/** Revalidates every surface a stock or price change is visible on. */
async function revalidateForVariant(variantId: string): Promise<void> {
  const products = await productsForVariants([variantId]);
  for (const product of products) {
    revalidatePath(`/admin/products/${product.id}`);
    await revalidateStorefrontForProduct(product);
  }
  revalidatePath('/admin/inventory');
  revalidatePath('/admin/inventory/history');
  revalidatePath('/admin/pricing');
}

export interface AdjustStockActionInput {
  /** Exactly one of these two — the service rejects both or neither. */
  delta?: number;
  setTo?: number;
  reason: ManualInventoryReason;
  note?: string;
}

export async function adjustStockAction(
  variantId: string,
  input: AdjustStockActionInput,
  locale: Locale,
): Promise<ActionResult<{ newQuantity: number; previousQuantity: number }>> {
  try {
    const user = await requirePermission('inventory.adjust');
    const { adjustment } = await adjustStock({
      variantId,
      delta: input.delta,
      setTo: input.setTo,
      reason: input.reason,
      note: input.note?.trim() || undefined,
      actorUserId: user.id,
    });

    await recordAuditEvent({
      action: 'inventory.adjusted',
      entityType: 'Variant',
      userId: user.id,
      entityId: variantId,
      before: { stockQuantity: adjustment.previousQuantity },
      after: {
        stockQuantity: adjustment.newQuantity,
        delta: adjustment.delta,
        reason: adjustment.reason,
        // The note is admin-written prose about stock ("counted the shelf"),
        // never a credential — the same reason nothing else on this path
        // carries anything from a session or a password field.
        note: adjustment.note,
      },
    });

    await revalidateForVariant(variantId);
    return {
      ok: true,
      data: {
        newQuantity: adjustment.newQuantity,
        previousQuantity: adjustment.previousQuantity,
      },
    };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function setInventoryPolicyAction(
  variantId: string,
  input: { trackInventory?: boolean; lowStockThreshold?: number },
  expectedUpdatedAt: string | null,
  locale: Locale,
): Promise<ActionResult<{ updatedAt: string }>> {
  try {
    const user = await requirePermission('inventory.adjust');
    const variant = await setInventoryPolicy(
      variantId,
      input,
      expectedUpdatedAt ? new Date(expectedUpdatedAt) : undefined,
    );

    await recordAuditEvent({
      action: 'inventory.policy_changed',
      entityType: 'Variant',
      userId: user.id,
      entityId: variantId,
      after: {
        trackInventory: variant.trackInventory,
        lowStockThreshold: variant.lowStockThreshold,
      },
    });

    await revalidateForVariant(variantId);
    return { ok: true, data: { updatedAt: variant.updatedAt.toISOString() } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}
