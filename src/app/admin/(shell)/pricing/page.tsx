import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ProductStatus } from '@generated/prisma';

import {
  getCategoryTree,
  listVariantsForAdmin,
  type CategoryNode,
  type VariantListingSort,
} from '@/modules/catalog';
import { roleHasPermission } from '@/modules/identity';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale, type Locale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { QueryToolbar, type QueryToolbarOption } from '@/components/admin/query-toolbar';
import { PricingTable, type PricingTableRow } from '@/components/admin/pricing-table';

export const metadata: Metadata = { title: 'Pricing' };

const SORTS: VariantListingSort[] = ['price-asc', 'price-desc', 'sku-asc', 'updated-desc'];
const STATUSES: ProductStatus[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function flattenCategories(nodes: CategoryNode[], locale: Locale, depth = 0): QueryToolbarOption[] {
  return nodes.flatMap((node) => [
    {
      value: node.id,
      label: `${'— '.repeat(depth)}${locale === 'ar' ? node.nameAr : node.nameEn}`,
    },
    ...flattenCategories(node.children, locale, depth + 1),
  ]);
}

export default async function AdminPricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // `products.read` to look; the actions themselves require
  // `products.update`, which is what the table's editors follow.
  const user = await requireAdminPermission('products.read');

  const params = await searchParams;
  const one = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  const [result, categoryTree] = await Promise.all([
    listVariantsForAdmin({
      q: one('q') || undefined,
      productId: one('productId') || undefined,
      categoryId: one('categoryId') || undefined,
      status: STATUSES.find((status) => status === one('status')),
      sort: SORTS.find((sort) => sort === one('sort')) ?? 'sku-asc',
      page: parsePositiveInt(one('page')) ?? 1,
    }),
    getCategoryTree(),
  ]);

  const rows: PricingTableRow[] = result.items.map((item) => ({
    variantId: item.variantId,
    sku: item.sku,
    variantLabel: (locale === 'ar' ? item.variantLabelAr : item.variantLabelEn) || item.sku,
    productId: item.productId,
    productName: locale === 'ar' ? item.productNameAr : item.productNameEn,
    priceMinor: item.priceMinor,
    compareAtMinor: item.compareAtMinor,
    updatedAt: item.updatedAt.toISOString(),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.pricing.title}
        description={t.pricing.resultCount.replace('{count}', String(result.total))}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[{ label: t.pricing.title }]}
          />
        }
      />

      <QueryToolbar
        searchKey="q"
        searchPlaceholder={t.pricing.searchPlaceholder}
        labels={{
          allOption: t.pricing.allOption,
          clearAll: t.products.clearAll,
          removeFilter: t.products.removeFilter,
        }}
        selects={[
          {
            key: 'categoryId',
            label: t.pricing.filterCategory,
            options: flattenCategories(categoryTree, locale),
          },
          {
            key: 'status',
            label: t.pricing.filterStatus,
            options: [
              { value: 'DRAFT', label: t.products.statusDraft },
              { value: 'PUBLISHED', label: t.products.statusPublished },
              { value: 'ARCHIVED', label: t.products.statusArchived },
            ],
          },
          {
            key: 'sort',
            label: t.pricing.sort,
            includeAll: false,
            options: [
              { value: 'sku-asc', label: t.pricing.sortSkuAsc },
              { value: 'price-asc', label: t.pricing.sortPriceAsc },
              { value: 'price-desc', label: t.pricing.sortPriceDesc },
              { value: 'updated-desc', label: t.pricing.sortUpdatedDesc },
            ],
          },
        ]}
      />

      <PricingTable
        rows={rows}
        page={result.page}
        pageCount={result.pageCount}
        locale={locale}
        canEdit={roleHasPermission(user.role, 'products.update')}
        labels={{
          colVariant: t.pricing.colVariant,
          colProduct: t.pricing.colProduct,
          colSku: t.pricing.colSku,
          colPrice: t.pricing.colPrice,
          colCompareAt: t.pricing.colCompareAt,
          actions: t.common.actions,
          emptyTitle: t.pricing.emptyTitle,
          emptyDescription: t.pricing.emptyDescription,
          save: t.pricing.save,
          saving: t.common.saving,
          cancel: t.common.cancel,
          priceSaved: t.pricing.priceSaved,
          bulkOpen: t.pricing.bulkOpen,
          bulkTitle: t.pricing.bulkTitle,
          bulkMode: t.pricing.bulkMode,
          bulkAbsolute: t.pricing.bulkAbsolute,
          bulkPercentage: t.pricing.bulkPercentage,
          bulkNewPrice: t.pricing.bulkNewPrice,
          bulkPercent: t.pricing.bulkPercent,
          bulkPercentHelp: t.pricing.bulkPercentHelp,
          bulkPreview: t.pricing.bulkPreview,
          bulkPreviewing: t.pricing.bulkPreviewing,
          bulkPreviewTitle: t.pricing.bulkPreviewTitle,
          bulkColCurrent: t.pricing.bulkColCurrent,
          bulkColNew: t.pricing.bulkColNew,
          bulkApply: t.pricing.bulkApply,
          bulkApplying: t.pricing.bulkApplying,
          bulkApplied: t.pricing.bulkApplied,
          bulkBlocked: t.pricing.bulkBlocked,
          bulkToolbar: t.pricing.bulkToolbar,
          bulkClear: t.pricing.bulkClear,
          bulkSelected: t.pricing.bulkSelected,
          selectAll: t.pricing.selectAll,
          selectRow: t.pricing.selectRow,
          previousPage: t.pricing.previousPage,
          nextPage: t.pricing.nextPage,
          pageLabel: t.pricing.pageLabel,
        }}
      />
    </div>
  );
}
