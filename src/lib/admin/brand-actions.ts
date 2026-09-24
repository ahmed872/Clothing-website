'use server';

import { revalidatePath } from 'next/cache';

import { adminErrorMessage } from '@/lib/admin/admin-error-message';
import { requirePermission } from '@/modules/identity';
import { recordAuditEvent } from '@/modules/identity';
import {
  createBrand,
  updateBrand,
  deleteBrand,
  type BrandInput,
  type BrandUpdateInput,
} from '@/modules/catalog';
import type { Locale } from '@/lib/i18n/locales';
import type { ActionResult } from '@/lib/admin/action-result';

/**
 * Every admin catalog mutation follows the same shape: `requirePermission`
 * first (the real, server-side authority — P06 §7/§15, never trusted to a
 * hidden button), then the domain service (which does its own validation),
 * then an audit event, then revalidate the list page that needs to reflect
 * the change. Returned as a plain result object rather than a thrown error
 * — the calling form reads `.error` and shows it inline, the same
 * server-action ergonomics `loginAction` (P06) already established.
 *
 * `locale` is threaded through explicitly (not read from a cookie here)
 * because `AppError.messageFor` needs to know which of its two prepared
 * strings to return, and a Server Action has no implicit request context of
 * its own the way a page does — the calling client component already knows
 * the admin's current locale and passes it straight through.
 */

export async function createBrandAction(
  input: BrandInput,
  locale: Locale,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('brands.manage');
    const brand = await createBrand(input);
    await recordAuditEvent({
      action: 'brand.created',
      entityType: 'Brand',
      userId: user.id,
      entityId: brand.id,
      after: { slug: brand.slug, nameEn: brand.nameEn },
    });
    revalidatePath('/admin/brands');
    return { ok: true, data: { id: brand.id } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function updateBrandAction(
  id: string,
  input: BrandUpdateInput,
  locale: Locale,
): Promise<ActionResult> {
  try {
    const user = await requirePermission('brands.manage');
    const brand = await updateBrand(id, input);
    await recordAuditEvent({
      action: 'brand.updated',
      entityType: 'Brand',
      userId: user.id,
      entityId: brand.id,
      after: input as Record<string, unknown>,
    });
    revalidatePath('/admin/brands');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function deleteBrandAction(id: string, locale: Locale): Promise<ActionResult> {
  try {
    const user = await requirePermission('brands.manage');
    await deleteBrand(id);
    await recordAuditEvent({
      action: 'brand.deleted',
      entityType: 'Brand',
      userId: user.id,
      entityId: id,
    });
    revalidatePath('/admin/brands');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}
