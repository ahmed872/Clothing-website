'use server';

import { revalidatePath } from 'next/cache';

import { adminErrorMessage } from '@/lib/admin/admin-error-message';
import { requirePermission } from '@/modules/identity';
import { recordAuditEvent } from '@/modules/identity';
import {
  attachProductImage,
  detachProductImage,
  setPrimaryProductImage,
  reorderProductImages,
} from '@/modules/catalog';
import type { Locale } from '@/lib/i18n/locales';
import type { ActionResult } from '@/lib/admin/action-result';

/**
 * Attaching, ordering and detaching a product's images. All four are
 * `products.update`: they change how a product appears in the storefront,
 * which is an edit to the product.
 *
 * Nothing here uploads anything — the browser already did that through
 * P04's `/api/media/*` flow (request → PUT → confirm) and hands over the
 * resulting `MediaAsset` id. `ProductImage` is only the association, so
 * detaching never destroys the asset itself.
 *
 * These are audited as `product.updated` rather than a separate image
 * action: from an admin's point of view, "who changed this product's
 * images" is part of "who changed this product".
 */

export async function attachProductImageAction(
  productId: string,
  mediaId: string,
  locale: Locale,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('products.update');
    const image = await attachProductImage(productId, mediaId);
    await recordAuditEvent({
      action: 'product.updated',
      entityType: 'Product',
      userId: user.id,
      entityId: productId,
      after: { imageAttached: mediaId },
    });
    revalidatePath(`/admin/products/${productId}`);
    return { ok: true, data: { id: image.id } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function detachProductImageAction(
  imageId: string,
  productId: string,
  locale: Locale,
): Promise<ActionResult> {
  try {
    const user = await requirePermission('products.update');
    await detachProductImage(imageId);
    await recordAuditEvent({
      action: 'product.updated',
      entityType: 'Product',
      userId: user.id,
      entityId: productId,
      after: { imageDetached: imageId },
    });
    revalidatePath(`/admin/products/${productId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function setPrimaryProductImageAction(
  imageId: string,
  productId: string,
  locale: Locale,
): Promise<ActionResult> {
  try {
    const user = await requirePermission('products.update');
    await setPrimaryProductImage(imageId);
    await recordAuditEvent({
      action: 'product.updated',
      entityType: 'Product',
      userId: user.id,
      entityId: productId,
      after: { primaryImage: imageId },
    });
    revalidatePath(`/admin/products/${productId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function reorderProductImagesAction(
  productId: string,
  orderedIds: string[],
  locale: Locale,
): Promise<ActionResult> {
  try {
    const user = await requirePermission('products.update');
    await reorderProductImages(productId, orderedIds);
    await recordAuditEvent({
      action: 'product.updated',
      entityType: 'Product',
      userId: user.id,
      entityId: productId,
      after: { imageOrder: orderedIds },
    });
    revalidatePath(`/admin/products/${productId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}
