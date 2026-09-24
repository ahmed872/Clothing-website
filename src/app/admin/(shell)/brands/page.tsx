import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { Plus } from 'lucide-react';

import { listBrandsWithProductCounts } from '@/modules/catalog';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { BrandsTable, type BrandTableRow } from '@/components/admin/brands-table';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Brands' };

export default async function AdminBrandsPage() {
  // `brands.manage` is the one permission governing every brand
  // operation — read included, there's no separate `brands.read`.
  await requireAdminPermission('brands.manage');

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  const brands = await listBrandsWithProductCounts();
  const rows: BrandTableRow[] = brands.map((b) => ({
    id: b.id,
    nameAr: b.nameAr,
    nameEn: b.nameEn,
    slug: b.slug,
    productCount: b.productCount,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.brands.title}
        description={t.brands.description}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[{ label: t.brands.title }]}
          />
        }
        actions={
          <Button asChild>
            <Link href="/admin/brands/new">
              <Plus className="size-4" aria-hidden="true" />
              {t.brands.newBrand}
            </Link>
          </Button>
        }
      />

      <BrandsTable
        rows={rows}
        locale={locale}
        labels={{
          colName: t.brands.colName,
          colSlug: t.brands.colSlug,
          colProducts: t.brands.colProducts,
          actions: t.common.actions,
          emptyTitle: t.brands.emptyTitle,
          emptyDescription: t.brands.emptyDescription,
          edit: t.common.edit,
          delete: t.common.delete,
          confirmDeleteTitle: t.common.confirmDeleteTitle,
          deleteConfirmDescription: t.brands.deleteConfirmDescription,
          cancel: t.common.cancel,
          confirm: t.common.confirm,
          deletedSuccessfully: t.common.deletedSuccessfully,
        }}
      />
    </div>
  );
}
