import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { BrandForm } from '@/components/admin/brand-form';

export const metadata: Metadata = { title: 'New brand' };

export default async function NewBrandPage() {
  await requireAdminPermission('brands.manage');

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.brands.newBrand}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[{ label: t.brands.title, href: '/admin/brands' }, { label: t.brands.newBrand }]}
          />
        }
      />
      <BrandForm
        locale={locale}
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
