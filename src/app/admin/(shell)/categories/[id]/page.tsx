import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';

import {
  getCategory,
  getCategoryTree,
  getDescendantCategoryIds,
  listAttributeDefinitions,
  getEffectiveAttributeDefinitions,
  type CategoryNode,
} from '@/modules/catalog';
import { getMediaAsset, getMediaPublicUrl } from '@/modules/media';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { CategoryForm, type CategoryParentOption } from '@/components/admin/category-form';
import {
  AttributeDefinitionsManager,
  type AttributeDefinitionRow,
} from '@/components/admin/attribute-definitions-manager';
import type { Locale } from '@/lib/i18n/locales';

export const metadata: Metadata = { title: 'Edit category' };

function flattenParentOptions(
  nodes: CategoryNode[],
  locale: Locale,
  excludeIds: Set<string>,
  depth = 0,
): CategoryParentOption[] {
  return nodes.flatMap((node) => {
    if (excludeIds.has(node.id)) return [];
    return [
      { id: node.id, label: locale === 'ar' ? node.nameAr : node.nameEn, depth },
      ...flattenParentOptions(node.children, locale, excludeIds, depth + 1),
    ];
  });
}

export default async function EditCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPermission('categories.manage');
  const { id } = await params;

  const category = await getCategory(id);
  if (!category) notFound();

  const [image, tree, descendantIds, ownDefinitions, effectiveDefinitions] = await Promise.all([
    category.imageMediaId ? getMediaAsset(category.imageMediaId) : Promise.resolve(null),
    getCategoryTree(),
    getDescendantCategoryIds(id),
    listAttributeDefinitions(id),
    getEffectiveAttributeDefinitions(id),
  ]);

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);
  const categoryLabel = locale === 'ar' ? category.nameAr : category.nameEn;

  // A category can't become its own descendant's child — excluded from the
  // parent picker (the server still enforces this in `updateCategory` via
  // `assertNoCycle`; this just keeps the UI from ever offering the choice).
  const excludeIds = new Set(descendantIds);
  const parentOptions = flattenParentOptions(tree, locale, excludeIds);

  const ownIds = new Set(ownDefinitions.map((d) => d.id));
  const attributeRows: AttributeDefinitionRow[] = effectiveDefinitions.map((definition) => ({
    id: definition.id,
    key: definition.key,
    labelAr: definition.labelAr,
    labelEn: definition.labelEn,
    type: definition.type,
    unit: definition.unit,
    allowedValues: (definition.allowedValues as string[] | null) ?? null,
    required: definition.required,
    filterable: definition.filterable,
    inherited: !ownIds.has(definition.id),
  }));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t.categories.editCategory}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[
              { label: t.categories.title, href: '/admin/categories' },
              { label: categoryLabel },
            ]}
          />
        }
      />
      <CategoryForm
        locale={locale}
        parentOptions={parentOptions}
        category={{
          id: category.id,
          nameAr: category.nameAr,
          nameEn: category.nameEn,
          slug: category.slug,
          parentId: category.parentId,
          position: category.position,
          imageMediaId: category.imageMediaId,
          imageSrc: image ? getMediaPublicUrl(image) : null,
          seoTitleAr: category.seoTitleAr,
          seoTitleEn: category.seoTitleEn,
          seoDescriptionAr: category.seoDescriptionAr,
          seoDescriptionEn: category.seoDescriptionEn,
        }}
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

      <AttributeDefinitionsManager
        categoryId={category.id}
        locale={locale}
        definitions={attributeRows}
        labels={{
          title: t.attributes.title,
          description: t.attributes.description,
          newAttribute: t.attributes.newAttribute,
          emptyTitle: t.attributes.emptyTitle,
          emptyDescription: t.attributes.emptyDescription,
          key: t.attributes.key,
          keyHelp: t.attributes.keyHelp,
          labelAr: t.attributes.labelAr,
          labelEn: t.attributes.labelEn,
          type: t.attributes.type,
          typeText: t.attributes.typeText,
          typeNumber: t.attributes.typeNumber,
          typeBoolean: t.attributes.typeBoolean,
          typeSelect: t.attributes.typeSelect,
          typeMultiSelect: t.attributes.typeMultiSelect,
          unit: t.attributes.unit,
          allowedValues: t.attributes.allowedValues,
          allowedValuesHelp: t.attributes.allowedValuesHelp,
          addValue: t.attributes.addValue,
          required: t.attributes.required,
          filterable: t.attributes.filterable,
          inherited: t.attributes.inherited,
          deleteConfirmDescription: t.attributes.deleteConfirmDescription,
          save: t.common.save,
          saving: t.common.saving,
          cancel: t.common.cancel,
          edit: t.common.edit,
          delete: t.common.delete,
          confirmDeleteTitle: t.common.confirmDeleteTitle,
          confirm: t.common.confirm,
          deletedSuccessfully: t.common.deletedSuccessfully,
          savedSuccessfully: t.common.savedSuccessfully,
          requiredField: t.common.requiredField,
        }}
      />
    </div>
  );
}
