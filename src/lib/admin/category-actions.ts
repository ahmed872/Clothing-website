'use server';

import { revalidatePath, updateTag } from 'next/cache';

import { adminErrorMessage } from '@/lib/admin/admin-error-message';
import { requirePermission } from '@/modules/identity';
import { recordAuditEvent } from '@/modules/identity';
import {
  createCategory,
  updateCategory,
  deleteCategory,
  type CategoryInput,
  type CategoryUpdateInput,
} from '@/modules/catalog';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/i18n/locales';
import type { ActionResult } from '@/lib/admin/action-result';

/**
 * A category change is a *storefront* change, not just an admin-list one.
 *
 * Every storefront page's header and footer render the category tree
 * through `getCachedStoreSettings`'s sibling `getCachedCategoryTree` — an
 * `unstable_cache` entry tagged `catalog:categories`
 * (`lib/cached-queries.ts`). Two things follow, and until P15 neither was
 * done here, so a renamed or newly created category simply did not appear
 * in the store's navigation:
 *
 *   - the tag has to be invalidated, because `revalidatePath` does not
 *     clear the Data Cache the entry lives in — with `updateTag` rather
 *     than `revalidateTag`, since these are Server Actions and an admin
 *     must see their own change rather than a stale-while-revalidate copy
 *     of it; and
 *   - the storefront routes have to be revalidated, because they are ISR
 *     and would otherwise serve their prerendered HTML for up to a minute.
 *
 * Same reasoning as `revalidate-storefront.ts` does for a product, and as
 * `settings-actions.ts` now does for the store's own row.
 */
function revalidateCategoryNavigation(): void {
  updateTag('catalog:categories');
  for (const storefrontLocale of SUPPORTED_LOCALES) {
    revalidatePath(`/${storefrontLocale}`, 'layout');
  }
}

export async function createCategoryAction(
  input: CategoryInput,
  locale: Locale,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('categories.manage');
    const category = await createCategory(input);
    await recordAuditEvent({
      action: 'category.created',
      entityType: 'Category',
      userId: user.id,
      entityId: category.id,
      after: { slug: category.slug, nameEn: category.nameEn },
    });
    revalidatePath('/admin/categories');
    revalidateCategoryNavigation();
    return { ok: true, data: { id: category.id } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function updateCategoryAction(
  id: string,
  input: CategoryUpdateInput,
  locale: Locale,
): Promise<ActionResult> {
  try {
    const user = await requirePermission('categories.manage');
    const category = await updateCategory(id, input);
    await recordAuditEvent({
      action: 'category.updated',
      entityType: 'Category',
      userId: user.id,
      entityId: category.id,
      after: input as Record<string, unknown>,
    });
    revalidatePath('/admin/categories');
    revalidateCategoryNavigation();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function deleteCategoryAction(id: string, locale: Locale): Promise<ActionResult> {
  try {
    const user = await requirePermission('categories.manage');
    await deleteCategory(id);
    await recordAuditEvent({
      action: 'category.deleted',
      entityType: 'Category',
      userId: user.id,
      entityId: id,
    });
    revalidatePath('/admin/categories');
    revalidateCategoryNavigation();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}
