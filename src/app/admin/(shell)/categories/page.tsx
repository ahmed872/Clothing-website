import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { Plus } from 'lucide-react';

import {
  getCategoryTreeWithProductCounts,
  type CategoryNodeWithProductCount,
} from '@/modules/catalog';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { CategoriesTable, type CategoryTableRow } from '@/components/admin/categories-table';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Categories' };

function flatten(nodes: CategoryNodeWithProductCount[], depth = 0): CategoryTableRow[] {
  return nodes.flatMap((node) => [
    {
      id: node.id,
      nameAr: node.nameAr,
      nameEn: node.nameEn,
      slug: node.slug,
      depth,
      productCount: node.productCount,
    },
    ...flatten(node.children, depth + 1),
  ]);
}

export default async function AdminCategoriesPage() {
  await requireAdminPermission('categories.manage');

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  const tree = await getCategoryTreeWithProductCounts();
  const rows = flatten(tree);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.categories.title}
        description={t.categories.description}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[{ label: t.categories.title }]}
          />
        }
        actions={
          <Button asChild>
            <Link href="/admin/categories/new">
              <Plus className="size-4" aria-hidden="true" />
              {t.categories.newCategory}
            </Link>
          </Button>
        }
      />

      <CategoriesTable
        rows={rows}
        locale={locale}
        labels={{
          colName: t.categories.colName,
          colSlug: t.categories.colSlug,
          colProducts: t.categories.colProducts,
          actions: t.common.actions,
          emptyTitle: t.categories.emptyTitle,
          emptyDescription: t.categories.emptyDescription,
          edit: t.common.edit,
          delete: t.common.delete,
          confirmDeleteTitle: t.common.confirmDeleteTitle,
          deleteConfirmDescription: t.categories.deleteConfirmDescription,
          cancel: t.common.cancel,
          confirm: t.common.confirm,
          deletedSuccessfully: t.common.deletedSuccessfully,
        }}
      />
    </div>
  );
}
