import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { getStoreSettingsRecord } from '@/modules/settings';
import { getMediaAsset, getMediaPublicUrl } from '@/modules/media';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { SettingsForm, type SettingsMedia } from '@/components/admin/settings-form';

export const metadata: Metadata = { title: 'Settings' };

/** A stored media id is only useful to the form if it still resolves; an
 * asset deleted since it was set comes back as an empty slot rather than a
 * broken image the admin cannot clear. */
async function resolveSlot(id: string | null): Promise<{ id: string; src: string } | null> {
  if (!id) return null;
  const asset = await getMediaAsset(id);
  return asset ? { id: asset.id, src: getMediaPublicUrl(asset) } : null;
}

export default async function AdminSettingsPage() {
  await requireAdminPermission('settings.manage');

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  const record = await getStoreSettingsRecord();
  const media: SettingsMedia = {
    logo: await resolveSlot(record.logoMediaId),
    logoDark: await resolveSlot(record.logoDarkMediaId),
    favicon: await resolveSlot(record.faviconMediaId),
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.settings.title}
        description={t.settings.description}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[{ label: t.settings.title }]}
          />
        }
      />

      <SettingsForm
        locale={locale}
        initialUpdatedAt={record.updatedAt ? record.updatedAt.toISOString() : null}
        initialMedia={media}
        initialValues={{
          storeNameAr: record.storeNameAr,
          storeNameEn: record.storeNameEn,
          currency: record.currency,
          defaultLocale: record.defaultLocale,
          whatsappNumber: record.whatsappNumber ?? '',
          contactPhone: record.contact.phone ?? '',
          contactEmail: record.contact.email ?? '',
          contactAddress: record.contact.address ?? '',
          instagram: record.socialLinks.instagram ?? '',
          x: record.socialLinks.x ?? '',
          facebook: record.socialLinks.facebook ?? '',
          tiktok: record.socialLinks.tiktok ?? '',
          youtube: record.socialLinks.youtube ?? '',
          seoTitleAr: record.seoDefaults.titleAr ?? '',
          seoTitleEn: record.seoDefaults.titleEn ?? '',
          seoDescriptionAr: record.seoDefaults.descriptionAr ?? '',
          seoDescriptionEn: record.seoDefaults.descriptionEn ?? '',
        }}
        labels={{
          ...t.settings,
          save: t.common.save,
          saving: t.common.saving,
          chooseFile: t.common.chooseFile,
          uploading: t.common.uploading,
          uploadError: t.common.uploadError,
        }}
      />
    </div>
  );
}
