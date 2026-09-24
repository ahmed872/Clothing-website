'use server';

import { revalidatePath } from 'next/cache';

import { adminErrorMessage } from '@/lib/admin/admin-error-message';
import { requirePermission } from '@/modules/identity';
import { recordAuditEvent } from '@/modules/identity';
import {
  createProductOption,
  addOptionValues,
  deleteProductOption,
  deleteOptionValue,
  generateMissingVariants,
  updateVariant,
  deleteVariant,
  type UpdateVariantInput,
} from '@/modules/catalog';
import type { Locale } from '@/lib/i18n/locales';
import type { ActionResult } from '@/lib/admin/action-result';

/**
 * Options and variants. All `products.update` — an option or a variant is
 * part of a product, and there is no separate permission for either in
 * P06's fixed set.
 *
 * Every guard that matters lives in the domain (`variant.service.ts`): a
 * duplicate SKU, a duplicate option name, deleting an option a variant
 * still uses, deleting the last variant of a published product. The UI
 * shows what comes back; it never decides.
 */

export async function createProductOptionAction(
  productId: string,
  input: { nameAr: string; nameEn: string; values: { valueAr: string; valueEn: string }[] },
  locale: Locale,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('products.update');
    const option = await createProductOption(productId, input);
    await recordAuditEvent({
      action: 'product.updated',
      entityType: 'Product',
      userId: user.id,
      entityId: productId,
      after: { optionCreated: option.nameEn },
    });
    revalidatePath(`/admin/products/${productId}`);
    return { ok: true, data: { id: option.id } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function addOptionValuesAction(
  optionId: string,
  productId: string,
  values: { valueAr: string; valueEn: string }[],
  locale: Locale,
): Promise<ActionResult> {
  try {
    const user = await requirePermission('products.update');
    await addOptionValues(optionId, values);
    await recordAuditEvent({
      action: 'product.updated',
      entityType: 'Product',
      userId: user.id,
      entityId: productId,
      after: { optionValuesAdded: values.map((v) => v.valueEn) },
    });
    revalidatePath(`/admin/products/${productId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function deleteProductOptionAction(
  optionId: string,
  productId: string,
  locale: Locale,
): Promise<ActionResult> {
  try {
    const user = await requirePermission('products.update');
    await deleteProductOption(optionId);
    await recordAuditEvent({
      action: 'product.updated',
      entityType: 'Product',
      userId: user.id,
      entityId: productId,
      after: { optionDeleted: optionId },
    });
    revalidatePath(`/admin/products/${productId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function deleteOptionValueAction(
  valueId: string,
  productId: string,
  locale: Locale,
): Promise<ActionResult> {
  try {
    const user = await requirePermission('products.update');
    await deleteOptionValue(valueId);
    await recordAuditEvent({
      action: 'product.updated',
      entityType: 'Product',
      userId: user.id,
      entityId: productId,
      after: { optionValueDeleted: valueId },
    });
    revalidatePath(`/admin/products/${productId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

/** "Generate combinations": creates a variant for every option combination
 * that doesn't have one yet, and touches nothing that already exists — so
 * per-variant prices, SKUs and stock survive re-generating after a new
 * option value is added. */
export async function generateVariantsAction(
  productId: string,
  locale: Locale,
): Promise<ActionResult<{ created: number }>> {
  try {
    const user = await requirePermission('products.update');
    const created = await generateMissingVariants(productId);
    if (created.length > 0) {
      await recordAuditEvent({
        action: 'variant.created',
        entityType: 'Variant',
        userId: user.id,
        entityId: productId,
        after: { generated: created.map((variant) => variant.sku) },
      });
    }
    revalidatePath(`/admin/products/${productId}`);
    return { ok: true, data: { created: created.length } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function updateVariantAction(
  variantId: string,
  productId: string,
  input: UpdateVariantInput,
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
      action: 'variant.updated',
      entityType: 'Variant',
      userId: user.id,
      entityId: variantId,
      after: input as Record<string, unknown>,
    });
    revalidatePath(`/admin/products/${productId}`);
    return { ok: true, data: { updatedAt: variant.updatedAt.toISOString() } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function deleteVariantAction(
  variantId: string,
  productId: string,
  locale: Locale,
): Promise<ActionResult> {
  try {
    const user = await requirePermission('products.update');
    await deleteVariant(variantId);
    await recordAuditEvent({
      action: 'variant.deleted',
      entityType: 'Variant',
      userId: user.id,
      entityId: variantId,
    });
    revalidatePath(`/admin/products/${productId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}
