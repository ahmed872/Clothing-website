import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/modules/core';
import { resetIdentityTables } from '@/modules/identity/testing';
import { resetSettingsTable } from '@/modules/settings/testing';
import { resetCatalogTables } from '@/modules/catalog/testing';
import { createUser } from '@/modules/identity/user.service';

/**
 * The storefront must show what the admin just saved.
 *
 * `Header` and `Footer` render on every storefront page and read the store
 * settings and the category tree through `unstable_cache` entries tagged
 * `settings:store` and `catalog:categories` (`lib/cached-queries.ts`).
 * Those entries live in Next's Data Cache, which **`revalidatePath` does
 * not clear** — only a tag invalidation does, and from a Server Action that
 * is `updateTag` (immediate, read-your-own-writes) rather than
 * `revalidateTag` (stale-while-revalidate).
 *
 * That distinction is invisible in code review and produced a real,
 * reported bug: an owner renamed their store, the admin recorded it, and
 * the storefront kept rendering the old name from cache. Nothing anywhere
 * in the application invalidated either tag at all.
 *
 * So these tests assert on the cache calls themselves rather than on a
 * rendered page: the tag names are a contract between the action that
 * writes and the cached query that reads, and a rendering test would pass
 * against a warm cache and prove nothing.
 */

const revalidatePath = vi.fn();
const updateTag = vi.fn();
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
  updateTag: (...args: unknown[]) => updateTag(...args),
}));

const authMock = vi.fn();
vi.mock('@/modules/identity/auth', () => ({ auth: authMock }));

const { updateStoreSettingsAction } = await import('./settings-actions');
const { createCategoryAction, updateCategoryAction, deleteCategoryAction } =
  await import('./category-actions');
const { getCategoryBySlug } = await import('@/modules/catalog');

/** The tags `lib/cached-queries.ts` declares. Spelled out literally: if one
 * is renamed there, this fails rather than the storefront quietly going
 * stale again. */
const SETTINGS_TAG = 'settings:store';
const CATEGORIES_TAG = 'catalog:categories';

const ACTOR_ID = '00000000-0000-4000-8000-0000000000ca';

function signInAsOwner(): void {
  authMock.mockResolvedValue({
    user: { id: ACTOR_ID, email: 'owner@example.com', name: null, role: 'OWNER' },
    expires: '2099-01-01T00:00:00.000Z',
  });
}

const SETTINGS_INPUT = {
  storeNameAr: 'متجر أحمد',
  storeNameEn: 'Ahmed Store',
  currency: 'SAR',
  defaultLocale: 'AR' as const,
  whatsappNumber: '',
  contact: { phone: '', email: '', address: '' },
  socialLinks: { instagram: '', x: '', facebook: '', tiktok: '', youtube: '' },
  seoDefaults: { titleAr: '', titleEn: '', descriptionAr: '', descriptionEn: '' },
  logoMediaId: '',
  logoDarkMediaId: '',
  faviconMediaId: '',
};

beforeEach(async () => {
  await resetCatalogTables();
  await resetSettingsTable();
  await resetIdentityTables();
  revalidatePath.mockReset();
  updateTag.mockReset();
  authMock.mockReset();

  const user = await createUser({
    email: 'cache-owner@example.com',
    password: 'cache-pass-1234',
    role: 'OWNER',
  });
  await db.user.update({ where: { id: user.id }, data: { id: ACTOR_ID } });
  signInAsOwner();
});

describe('renaming the store', () => {
  it('invalidates the cached settings the storefront header reads', async () => {
    const result = await updateStoreSettingsAction(SETTINGS_INPUT, null, 'en');

    expect(result.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith(SETTINGS_TAG);
  });

  it('still revalidates the storefront routes themselves', async () => {
    await updateStoreSettingsAction(SETTINGS_INPUT, null, 'en');

    // Both halves are needed: the tag clears the Data Cache entry, the path
    // clears the prerendered HTML that embedded it.
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('actually stores the new name, so the invalidation has something to reveal', async () => {
    await updateStoreSettingsAction(SETTINGS_INPUT, null, 'en');

    const row = await db.storeSettings.findFirstOrThrow();
    expect(row.storeNameEn).toBe('Ahmed Store');
    expect(row.storeNameAr).toBe('متجر أحمد');
  });

  it('does not invalidate anything when the caller was refused', async () => {
    authMock.mockResolvedValue(null);

    expect((await updateStoreSettingsAction(SETTINGS_INPUT, null, 'en')).ok).toBe(false);
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe('changing a category', () => {
  const input = { slug: 'cache-cat', nameAr: 'فئة', nameEn: 'Cache category' };

  it('invalidates the cached category tree on create', async () => {
    expect((await createCategoryAction(input, 'en')).ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith(CATEGORIES_TAG);
  });

  it('invalidates it on rename', async () => {
    await createCategoryAction(input, 'en');
    const category = await getCategoryBySlug('cache-cat');
    updateTag.mockReset();

    expect((await updateCategoryAction(category!.id, { nameEn: 'Renamed' }, 'en')).ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith(CATEGORIES_TAG);
  });

  it('invalidates it on delete', async () => {
    await createCategoryAction(input, 'en');
    const category = await getCategoryBySlug('cache-cat');
    updateTag.mockReset();

    expect((await deleteCategoryAction(category!.id, 'en')).ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith(CATEGORIES_TAG);
  });

  it('revalidates both storefront locales, not only the admin list', async () => {
    await createCategoryAction(input, 'en');

    expect(revalidatePath).toHaveBeenCalledWith('/ar', 'layout');
    expect(revalidatePath).toHaveBeenCalledWith('/en', 'layout');
  });

  it('does not invalidate anything when the caller was refused', async () => {
    authMock.mockResolvedValue(null);

    expect((await createCategoryAction(input, 'en')).ok).toBe(false);
    expect(updateTag).not.toHaveBeenCalled();
  });
});
