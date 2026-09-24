import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';

import { getBrand } from '@/modules/catalog';
import { getMediaAsset, getMediaPublicUrl } from '@/modules/media';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { BrandForm } from '@/components/admin/brand-form';

export const metadata: Metadata = { title: 'Edit brand' };

export default async function EditBrandPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPermission('brands.manage');
  const { id } = await params;

  const brand = await getBrand(id);
  if (!brand) notFound();

  const logo = brand.logoMediaId ? await getMediaAsset(brand.logoMediaId) : null;

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);
  const brandLabel = locale === 'ar' ? brand.nameAr : brand.nameEn;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.brands.editBrand}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[{ label: t.brands.title, href: '/admin/brands' }, { label: brandLabel }]}
          />
        }
      />
      <BrandForm
        locale={locale}
        brand={{
          id: brand.id,
          nameAr: brand.nameAr,
          nameEn: brand.nameEn,
          slug: brand.slug,
          logoMediaId: brand.logoMediaId,
          logoSrc: logo ? getMediaPublicUrl(logo) : null,
        }}
        labels={{
          nameAr: t.common.nameAr,
          nameEn: t.common.nameEn,
          slug: t.common.slug,
          slugHelp: t.common.slugHelp,
          logo: t.common.logo,
          chooseFile: t.common.chooseFile,
          uploading: t.common.uploading,
          uploadError: t.common.uploadError,
          save: t.common.save,
          saving: t.common.saving,
          cancel: t.common.cancel,
          requiredField: t.common.requiredField,
          createdSuccess: t.brands.createdSuccess,
          updatedSuccess: t.brands.updatedSuccess,
        }}
      />
    </div>
  );
}
