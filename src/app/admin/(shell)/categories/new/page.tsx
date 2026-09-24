import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { getCategoryTree, type CategoryNode } from '@/modules/catalog';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { CategoryForm, type CategoryParentOption } from '@/components/admin/category-form';
import type { Locale } from '@/lib/i18n/locales';

export const metadata: Metadata = { title: 'New category' };

function flattenParentOptions(
  nodes: CategoryNode[],
  locale: Locale,
  depth = 0,
): CategoryParentOption[] {
  return nodes.flatMap((node) => [
    { id: node.id, label: locale === 'ar' ? node.nameAr : node.nameEn, depth },
    ...flattenParentOptions(node.children, locale, depth + 1),
  ]);
}

export default async function NewCategoryPage() {
  await requireAdminPermission('categories.manage');

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  const tree = await getCategoryTree();
  const parentOptions = flattenParentOptions(tree, locale);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.categories.newCategory}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[
              { label: t.categories.title, href: '/admin/categories' },
              { label: t.categories.newCategory },
            ]}
          />
        }
      />
      <CategoryForm
        locale={locale}
        parentOptions={parentOptions}
        labels={{
          nameAr: t.common.nameAr,
          nameEn: t.common.nameEn,
          slug: t.common.slug,
          slugHelp: t.common.slugHelp,
          parent: t.categories.parent,
          noneOption: t.categories.noneOption,
          position: t.categories.position,
          positionHelp: t.categories.positionHelp,
          image: t.common.image,
          chooseFile: t.common.chooseFile,
          uploading: t.common.uploading,
          uploadError: t.common.uploadError,
          seoSection: t.categories.seoSection,
          seoTitleAr: t.categories.seoTitleAr,
          seoTitleEn: t.categories.seoTitleEn,
          seoDescriptionAr: t.categories.seoDescriptionAr,
          seoDescriptionEn: t.categories.seoDescriptionEn,
          save: t.common.save,
          saving: t.common.saving,
          cancel: t.common.cancel,
          requiredField: t.common.requiredField,
          createdSuccess: t.categories.createdSuccess,
          updatedSuccess: t.categories.updatedSuccess,
        }}
      />
    </div>
  );
}
