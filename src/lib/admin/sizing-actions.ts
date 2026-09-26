'use server';

import { revalidatePath } from 'next/cache';

import { adminErrorMessage } from '@/lib/admin/admin-error-message';
import { revalidateStorefrontForProduct } from '@/lib/admin/revalidate-storefront';
import { AppError, db } from '@/modules/core';
import { recordAuditEvent, requirePermission } from '@/modules/identity';
import {
  deleteProductSizing,
  saveProductSizing,
  sizeChartErrorsFromIssues,
  sizeChartInputSchema,
  type ProductSizingView,
  type SizeChartFieldErrors,
  type SizeChartInput,
} from '@/modules/sizing';
import type { Locale } from '@/lib/i18n/locales';

/**
 * A product's sizing (clothing P02), the same shape as every P07 admin
 * action: `requirePermission('products.update')` first — a size chart is
 * part of a product, the way options and variants are — then the domain
 * service, an audit entry, and revalidation of the product's storefront
 * pages so a published chart shows up at once.
 *
 * Every id the editor sends (the size option, each size) is re-checked by
 * `saveProductSizing` to belong to `productId`, inside the write's own
 * transaction; the UI's own list of options decides nothing.
 */

export interface SizingActionResult {
  ok: boolean;
  sizing?: SerializedProductSizing | null;
  error?: string;
  fieldErrors?: SizeChartFieldErrors;
}

export type SerializedProductSizing = Omit<ProductSizingView, 'updatedAt'> & { updatedAt: string };

function serialize(view: ProductSizingView): SerializedProductSizing {
  return { ...view, updatedAt: view.updatedAt.toISOString() };
}

function parseVersion(raw: string | null): Date | null | 'invalid' {
  if (raw === null) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? 'invalid' : date;
}

async function revalidateProduct(productId: string): Promise<void> {
  revalidatePath(`/admin/products/${productId}`);
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { slug: true, categoryId: true },
  });
  if (product) await revalidateStorefrontForProduct(product);
}

export async function saveProductSizingAction(
  productId: string,
  input: SizeChartInput,
  /** The `updatedAt` the editor opened with, or null for a new chart. */
  expectedUpdatedAt: string | null,
  locale: Locale,
): Promise<SizingActionResult> {
  try {
    const user = await requirePermission('products.update');

    const parsed = sizeChartInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: adminErrorMessage(new AppError('VALIDATION_FAILED'), locale),
        fieldErrors: sizeChartErrorsFromIssues(parsed.error.issues),
      };
    }
    // A version that is not a date cannot match any saved one: it is
    // treated as the stale save it would be.
    const expected = parseVersion(expectedUpdatedAt);
    if (expected === 'invalid') {
      const stale = new AppError('CONFLICT', { details: { reasonCode: 'sizing_stale' } });
      return { ok: false, error: adminErrorMessage(stale, locale) };
    }

    const saved = await saveProductSizing(productId, input, { expectedUpdatedAt: expected });
    await recordAuditEvent({
      action: 'product.updated',
      entityType: 'Product',
      userId: user.id,
      entityId: productId,
      after: {
        sizingSaved: saved.garmentType,
        sizes: saved.entries.map((entry) => entry.labelEn),
      },
    });
    await revalidateProduct(productId);
    return { ok: true, sizing: serialize(saved) };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function deleteProductSizingAction(
  productId: string,
  locale: Locale,
): Promise<SizingActionResult> {
  try {
    const user = await requirePermission('products.update');
    const deleted = await deleteProductSizing(productId);
    if (deleted) {
      await recordAuditEvent({
        action: 'product.updated',
        entityType: 'Product',
        userId: user.id,
        entityId: productId,
        after: { sizingRemoved: true },
      });
      await revalidateProduct(productId);
    }
    return { ok: true, sizing: null };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}
