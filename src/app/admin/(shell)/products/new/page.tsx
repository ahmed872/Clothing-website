import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { getCategoryTree, listBrands, getEffectiveAttributeDefinitions } from '@/modules/catalog';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale, type Locale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { ProductForm, type ProductOption } from '@/components/admin/product-form';
import type { AttributeFieldDefinition } from '@/lib/admin/product-actions';
import type { CategoryNode } from '@/modules/catalog';

export const metadata: Metadata = { title: 'New product' };

function flattenCategories(nodes: CategoryNode[], locale: Locale, depth = 0): ProductOption[] {
  return nodes.flatMap((node) => [
    {
      value: node.id,
      label: `${'— '.repeat(depth)}${locale === 'ar' ? node.nameAr : node.nameEn}`,
    },
    ...flattenCategories(node.children, locale, depth + 1),
  ]);
}

export default async function NewProductPage() {
  await requireAdminPermission('products.create');

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  const [tree, brands] = await Promise.all([getCategoryTree(), listBrands()]);
  const categoryOptions = flattenCategories(tree, locale);

  // The form defaults to the first category, so its attribute fields are
  // already correct on the very first paint rather than appearing a moment
  // later — the client only re-fetches when the admin changes the category.
  const firstCategoryId = categoryOptions[0]?.value;
  const definitions = firstCategoryId
    ? await getEffectiveAttributeDefinitions(firstCategoryId)
    : [];
  const initialAttributeDefinitions: AttributeFieldDefinition[] = definitions.map((definition) => ({
    id: definition.id,
    key: definition.key,
    labelAr: definition.labelAr,
    labelEn: definition.labelEn,
    type: definition.type,
    unit: definition.unit,
    allowedValues: (definition.allowedValues as string[] | null) ?? null,
    required: definition.required,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.products.newProduct}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[
              { label: t.products.title, href: '/admin/products' },
              { label: t.products.newProduct },
            ]}
          />
        }
      />
      <ProductForm
        locale={locale}
        categoryOptions={categoryOptions}
        brandOptions={brands.map((brand) => ({
          value: brand.id,
          label: locale === 'ar' ? brand.nameAr : brand.nameEn,
        }))}
        initialAttributeDefinitions={initialAttributeDefinitions}
        labels={{
          sectionBasic: t.products.sectionBasic,
          sectionBasicDescription: t.products.sectionBasicDescription,
          sectionAttributes: t.products.sectionAttributes,
          sectionAttributesDescription: t.products.sectionAttributesDescription,
          sectionPricing: t.products.sectionPricing,
          sectionPricingDescription: t.products.sectionPricingDescription,
          sectionSeo: t.products.sectionSeo,
          sectionSeoDescription: t.products.sectionSeoDescription,
          nameAr: t.common.nameAr,
          nameEn: t.common.nameEn,
          slug: t.common.slug,
          slugHelp: t.common.slugHelp,
          descriptionAr: t.products.descriptionAr,
          descriptionEn: t.products.descriptionEn,
          category: t.products.category,
          brand: t.products.brand,
          noneOption: t.common.noneOption,
          featured: t.products.featured,
          sku: t.products.sku,
          skuHelp: t.products.skuHelp,
          price: t.products.price,
          priceHelp: t.products.priceHelp,
          stockQuantity: t.products.stockQuantity,
          stockQuantityHelp: t.products.stockQuantityHelp,
          attributesEmpty: t.products.attributesEmpty,
          selectCategoryFirst: t.products.selectCategoryFirst,
          seoTitleAr: t.products.seoTitleAr,
          seoTitleEn: t.products.seoTitleEn,
          seoDescriptionAr: t.products.seoDescriptionAr,
          seoDescriptionEn: t.products.seoDescriptionEn,
          save: t.common.save,
          saveDraft: t.common.saveDraft,
          saving: t.common.saving,
          cancel: t.common.cancel,
          requiredField: t.common.requiredField,
          createdSuccess: t.products.createdSuccess,
          updatedSuccess: t.products.updatedSuccess,
        }}
      />
    </div>
  );
}
