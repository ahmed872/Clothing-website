'use server';

import { revalidatePath, updateTag } from 'next/cache';

import { adminErrorMessage } from '@/lib/admin/admin-error-message';
import { recordAuditEvent, requirePermission } from '@/modules/identity';
import { updateStoreSettings, type StoreSettingsInput } from '@/modules/settings';
import type { Locale } from '@/lib/i18n/locales';
import type { ActionResult } from '@/lib/admin/action-result';

/**
 * Store settings (P15) — one row, one action.
 *
 * Same shape as every other admin action file: `requirePermission` first,
 * then the domain service, then an audit event, then revalidate. Two things
 * are specific to this one:
 *
 *   - **`settings.manage` is not a catalog permission.** STAFF holds none of
 *     it; a MANAGER does. The check is what enforces that, not the sidebar.
 *   - **Revalidation is broad on purpose, and has two halves.** The store's
 *     name, currency and branding are rendered by *every* storefront page,
 *     so a settings save is the one admin write that legitimately
 *     invalidates the whole storefront rather than one list —
 *     `revalidatePath('/', 'layout')` covers the locale tree beneath it.
 *
 *     That alone is not enough, and P15 found this the hard way: the header
 *     and footer do not read `getStoreSettings` directly, they read
 *     `getCachedStoreSettings`, an `unstable_cache` entry tagged
 *     `settings:store` (`lib/cached-queries.ts`). That entry lives in the
 *     Data Cache, which `revalidatePath` does not clear — so a renamed
 *     store kept rendering its old name from cache until the tag's own 60s
 *     window happened to lapse. Nothing in the application invalidated that
 *     tag at all.
 *
 *     `updateTag`, not `revalidateTag`: this is a Server Action, and the
 *     person who just pressed Save is precisely the one who must not be
 *     served stale content. `revalidateTag`'s recommended `max` profile is
 *     stale-while-revalidate — right for a blog, wrong for "I renamed my
 *     store and it still shows the old name". `updateTag` expires the entry
 *     immediately and is documented as the read-your-own-writes tool for
 *     Server Actions.
 */
export async function updateStoreSettingsAction(
  input: StoreSettingsInput,
  expectedUpdatedAt: Date | null,
  locale: Locale,
): Promise<ActionResult<{ updatedAt: Date | null }>> {
  try {
    const actor = await requirePermission('settings.manage');

    const updated = await updateStoreSettings(input, expectedUpdatedAt);

    await recordAuditEvent({
      action: 'settings.updated',
      entityType: 'StoreSettings',
      userId: actor.id,
      // Never the whole row: `contact` carries the store's own phone and
      // address, and an audit entry is read by more people than the form
      // is. The fields worth answering "who changed this" about are the
      // ones that change what customers are charged and what the store is
      // called.
      after: {
        storeNameEn: updated.storeNameEn,
        storeNameAr: updated.storeNameAr,
        currency: updated.currency,
        defaultLocale: updated.defaultLocale,
      },
    });

    updateTag('settings:store');
    revalidatePath('/', 'layout');
    revalidatePath('/admin/settings');

    return { ok: true, data: { updatedAt: updated.updatedAt } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}
