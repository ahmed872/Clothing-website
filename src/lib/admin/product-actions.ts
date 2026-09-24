'use server';

import { revalidatePath } from 'next/cache';

import { adminErrorMessage } from '@/lib/admin/admin-error-message';
import { requirePermission } from '@/modules/identity';
import { recordAuditEvent } from '@/modules/identity';
import {
  createProduct,
  updateProduct,
  publishProduct,
  archiveProduct,
  softDeleteProduct,
  getEffectiveAttributeDefinitions,
  type ProductCoreInput,
  type ProductUpdateInput,
} from '@/modules/catalog';
import type { Locale } from '@/lib/i18n/locales';
import { revalidateStorefrontForProduct } from '@/lib/admin/revalidate-storefront';
import type { ActionResult } from '@/lib/admin/action-result';

/**
 * Product mutations. Same shape as every other P07 action file:
 * `requirePermission` first (the server is the authority, never a hidden
 * button — P07 §15/§21), then the domain service, then the audit event,
 * then revalidate.
 *
 * Products are the one entity with a split permission set: reading,
 * creating, updating and deleting are four separate P06 permissions, so a
 * STAFF account that may view the catalog still cannot publish or delete
 * anything.
 */

export interface CreateProductActionInput {
  product: ProductCoreInput;
  /** A product is never variant-less (`createProduct` enforces it), so the
   * create form collects one SKU, price and opening stock up front;
   * options and further variants are built afterwards on the edit page.
   *
   * `stockQuantity` is here because without it every product was created
   * with the column's default of zero and shown to customers as out of
   * stock, with no way to fix it from the screen that created it. */
  initialVariant: { sku: string; priceMinor: number; stockQuantity?: number };
}

export async function createProductAction(
  input: CreateProductActionInput,
  locale: Locale,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('products.create');
    const product = await createProduct({
      product: { ...input.product, status: 'DRAFT' },
      variants: [
        {
          sku: input.initialVariant.sku,
          priceMinor: input.initialVariant.priceMinor,
          stockQuantity: input.initialVariant.stockQuantity ?? 0,
        },
      ],
    });
    await recordAuditEvent({
      action: 'product.created',
      entityType: 'Product',
      userId: user.id,
      entityId: product.id,
      after: { slug: product.slug, nameEn: product.nameEn, status: product.status },
    });
    revalidatePath('/admin/products');
    return { ok: true, data: { id: product.id } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function updateProductAction(
  id: string,
  input: ProductUpdateInput,
  /** ISO string of the `updatedAt` the form was loaded with — the optimistic
   * concurrency check (P07 §23). Crosses the boundary as a string because a
   * `Date` in a Server Action payload is serialized, and comparing the two
   * as `Date`s server-side is unambiguous. */
  expectedUpdatedAt: string | null,
  locale: Locale,
): Promise<ActionResult<{ updatedAt: string }>> {
  try {
    const user = await requirePermission('products.update');
    const product = await updateProduct(
      id,
      input,
      expectedUpdatedAt ? new Date(expectedUpdatedAt) : undefined,
    );
    await recordAuditEvent({
      action: 'product.updated',
      entityType: 'Product',
      userId: user.id,
      entityId: product.id,
      after: input as Record<string, unknown>,
    });
    revalidatePath('/admin/products');
    revalidatePath(`/admin/products/${id}`);
    await revalidateStorefrontForProduct(product);
    return { ok: true, data: { updatedAt: product.updatedAt.toISOString() } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

/** Publishing is its own action rather than a status field on the edit form:
 * the server re-runs `assertPublishable` (P07 §24 — the server decides
 * publishability, and a product never ends up PUBLISHED with invalid data),
 * and it is worth a distinct audit action from an ordinary edit. */
export async function publishProductAction(
  id: string,
  locale: Locale,
): Promise<ActionResult<{ updatedAt: string }>> {
  try {
    const user = await requirePermission('products.update');
    const product = await publishProduct(id);
    await recordAuditEvent({
      action: 'product.published',
      entityType: 'Product',
      userId: user.id,
      entityId: product.id,
      after: { status: product.status },
    });
    revalidatePath('/admin/products');
    revalidatePath(`/admin/products/${id}`);
    await revalidateStorefrontForProduct(product);
    return { ok: true, data: { updatedAt: product.updatedAt.toISOString() } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function archiveProductAction(
  id: string,
  locale: Locale,
): Promise<ActionResult<{ updatedAt: string }>> {
  try {
    const user = await requirePermission('products.update');
    const product = await archiveProduct(id);
    await recordAuditEvent({
      action: 'product.archived',
      entityType: 'Product',
      userId: user.id,
      entityId: product.id,
      after: { status: product.status },
    });
    revalidatePath('/admin/products');
    revalidatePath(`/admin/products/${id}`);
    await revalidateStorefrontForProduct(product);
    return { ok: true, data: { updatedAt: product.updatedAt.toISOString() } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

/** Soft delete — gated on `products.delete`, which STAFF does not have (a
 * store manager does; see `ROLE_PERMISSIONS`). Never a hard delete: order
 * history, reviews and analytics all still point at this row (ADR-021). */
export async function deleteProductAction(id: string, locale: Locale): Promise<ActionResult> {
  try {
    const user = await requirePermission('products.delete');
    const product = await softDeleteProduct(id);
    await recordAuditEvent({
      action: 'product.deleted',
      entityType: 'Product',
      userId: user.id,
      entityId: id,
      after: { softDeleted: true },
    });
    revalidatePath('/admin/products');
    await revalidateStorefrontForProduct(product);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export interface BulkResult {
  succeeded: number;
  /** One entry per product that could not be changed, so the admin sees
   * exactly which ones and why instead of a bare "3 of 10 failed". */
  failures: { id: string; error: string }[];
}

/**
 * Bulk publish / archive (P07 §14 — only the bulk operations that carry
 * real value; there is no bulk delete here, and no bulk edit of fields
 * nobody asked to change in bulk).
 *
 * Not a shortcut past the rules: the permission is checked once for the
 * caller, then each product goes through the same domain call a single
 * publish or archive would, so a product that is not publishable is
 * skipped and reported rather than forced through. Each success is
 * audited individually — "who published these twelve products" has to be
 * answerable per product, not per click.
 */
export async function bulkProductStatusAction(
  ids: string[],
  operation: 'publish' | 'archive',
  locale: Locale,
): Promise<ActionResult<BulkResult>> {
  try {
    const user = await requirePermission('products.update');
    const result: BulkResult = { succeeded: 0, failures: [] };

    for (const id of ids) {
      try {
        const product =
          operation === 'publish' ? await publishProduct(id) : await archiveProduct(id);
        await recordAuditEvent({
          action: operation === 'publish' ? 'product.published' : 'product.archived',
          entityType: 'Product',
          userId: user.id,
          entityId: product.id,
          after: { status: product.status, bulk: true },
        });
        await revalidateStorefrontForProduct(product);
        result.succeeded += 1;
      } catch (error) {
        result.failures.push({ id, error: adminErrorMessage(error, locale) });
      }
    }

    revalidatePath('/admin/products');
    return { ok: true, data: result };
  } catch (error) {
    // Only a failure of the permission check itself reaches here — a
    // per-product failure is data in `failures`, not an error.
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export interface AttributeFieldDefinition {
  id: string;
  key: string;
  labelAr: string;
  labelEn: string;
  type: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SELECT' | 'MULTI_SELECT';
  unit: string | null;
  allowedValues: string[] | null;
  required: boolean;
}

/**
 * The product form asks for this whenever its category selection changes:
 * the fields an admin must fill are defined by the chosen category's
 * effective attribute set, which is data, not code (P07 §5). Read-only, so
 * `products.read` is the right gate — but it is still gated: the attribute
 * schema of a category is not public information.
 */
export async function attributeFieldsForCategoryAction(
  categoryId: string,
): Promise<ActionResult<AttributeFieldDefinition[]>> {
  try {
    await requirePermission('products.read');
    const definitions = await getEffectiveAttributeDefinitions(categoryId);
    return {
      ok: true,
      data: definitions.map((definition) => ({
        id: definition.id,
        key: definition.key,
        labelAr: definition.labelAr,
        labelEn: definition.labelEn,
        type: definition.type,
        unit: definition.unit,
        allowedValues: (definition.allowedValues as string[] | null) ?? null,
        required: definition.required,
      })),
    };
  } catch {
    // The caller renders "no fields" rather than an error banner: a failure
    // here is a permission or lookup problem, and the server re-validates
    // the attributes on save regardless of what the form managed to show.
    return { ok: false, data: [] };
  }
}
