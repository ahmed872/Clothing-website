import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { Plus } from 'lucide-react';
import type { ProductStatus } from '@generated/prisma';

import {
  listProductsForAdmin,
  listBrands,
  getCategoryTree,
  type AdminProductSort,
  type AdminStockFilter,
  type CategoryNode,
} from '@/modules/catalog';
import { formatMoney } from '@/modules/core';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale, type Locale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { formatAdminDate } from '@/lib/admin/format-admin-date';
import { roleHasPermission } from '@/modules/identity';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { ProductsToolbar, type ProductsToolbarOption } from '@/components/admin/products-toolbar';
import { ProductsTable, type ProductTableRow } from '@/components/admin/products-table';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Products' };

const SORTS: AdminProductSort[] = [
  'updated-desc',
  'updated-asc',
  'name-asc',
  'name-desc',
  'status',
];
const STATUSES: ProductStatus[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];
const STOCKS: AdminStockFilter[] = ['in_stock', 'out_of_stock'];

/** A query string is user input: every value is validated against what the
 * domain actually accepts before it reaches the service, so a hand-edited
 * URL can only ever produce a valid query or fall back to the default —
 * never an unhandled error, and never an unfiltered dump. */
function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function flattenCategories(
  nodes: CategoryNode[],
  locale: Locale,
  depth = 0,
): ProductsToolbarOption[] {
  return nodes.flatMap((node) => [
    {
      value: node.id,
      label: `${'— '.repeat(depth)}${locale === 'ar' ? node.nameAr : node.nameEn}`,
    },
    ...flattenCategories(node.children, locale, depth + 1),
  ]);
}

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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

  const statusParam = one('status');
  const status = STATUSES.find((s) => s === statusParam);
  const sortParam = one('sort');
  const sort = SORTS.find((s) => s === sortParam) ?? 'updated-desc';
  const stockParam = one('stock');
  const stock = STOCKS.find((s) => s === stockParam);

  // Prices are typed in major units (what an admin sees on the page), stored
  // and queried in minor units.
  const priceMin = parsePositiveInt(one('priceMin'));
  const priceMax = parsePositiveInt(one('priceMax'));

  const [result, categoryTree, brands] = await Promise.all([
    listProductsForAdmin({
      q: one('q') || undefined,
      status,
      categoryId: one('categoryId') || undefined,
      brandId: one('brandId') || undefined,
      priceMinMinor: priceMin === undefined ? undefined : priceMin * 100,
      priceMaxMinor: priceMax === undefined ? undefined : priceMax * 100,
      stock,
      sort,
      page: parsePositiveInt(one('page')) ?? 1,
    }),
    getCategoryTree(),
    listBrands(),
  ]);

  const rows: ProductTableRow[] = result.items.map((item) => ({
    id: item.id,
    name: locale === 'ar' ? item.nameAr : item.nameEn,
    skuSummary: item.skuSummary,
    variantCount: item.variantCount,
    categoryName: item.category
      ? locale === 'ar'
        ? item.category.nameAr
        : item.category.nameEn
      : null,
    brandName: item.brand ? (locale === 'ar' ? item.brand.nameAr : item.brand.nameEn) : null,
    price: item.price ? formatMoney(item.price.currentMinor, { locale }) : null,
    compareAtPrice:
      item.price?.onSale && item.price.compareAtMinor
        ? formatMoney(item.price.compareAtMinor, { locale })
        : null,
    stockStatus: item.stockStatus,
    status: item.status,
    updatedAt: formatAdminDate(item.updatedAt, locale),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.products.title}
        description={t.products.resultCount.replace('{count}', String(result.total))}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[{ label: t.products.title }]}
          />
        }
        actions={
          <Button asChild>
            <Link href="/admin/products/new">
              <Plus className="size-4" aria-hidden="true" />
              {t.products.newProduct}
            </Link>
          </Button>
        }
      />

      <ProductsToolbar
        labels={{
          searchPlaceholder: t.products.searchPlaceholder,
          filterStatus: t.products.filterStatus,
          filterCategory: t.products.filterCategory,
          filterBrand: t.products.filterBrand,
          filterStock: t.products.filterStock,
          filterPriceMin: t.products.filterPriceMin,
          filterPriceMax: t.products.filterPriceMax,
          allOption: t.products.allOption,
          sort: t.products.sort,
          clearAll: t.products.clearAll,
          removeFilter: t.products.removeFilter,
        }}
        statusOptions={[
          { value: 'DRAFT', label: t.products.statusDraft },
          { value: 'PUBLISHED', label: t.products.statusPublished },
          { value: 'ARCHIVED', label: t.products.statusArchived },
        ]}
        categoryOptions={flattenCategories(categoryTree, locale)}
        brandOptions={brands.map((brand) => ({
          value: brand.id,
          label: locale === 'ar' ? brand.nameAr : brand.nameEn,
        }))}
        stockOptions={[
          { value: 'in_stock', label: t.products.stockIn },
          { value: 'out_of_stock', label: t.products.stockOut },
        ]}
        sortOptions={[
          { value: 'updated-desc', label: t.products.sortUpdatedDesc },
          { value: 'updated-asc', label: t.products.sortUpdatedAsc },
          { value: 'name-asc', label: t.products.sortNameAsc },
          { value: 'name-desc', label: t.products.sortNameDesc },
          { value: 'status', label: t.products.sortStatus },
        ]}
      />

      <ProductsTable
        rows={rows}
        page={result.page}
        pageCount={result.pageCount}
        locale={locale}
        canEdit={roleHasPermission(user.role, 'products.update')}
        labels={{
          colProduct: t.products.colProduct,
          colSku: t.products.colSku,
          colCategory: t.products.colCategory,
          colBrand: t.products.colBrand,
          colPrice: t.products.colPrice,
          colStock: t.products.colStock,
          status: t.common.status,
          updatedAt: t.common.updatedAt,
          actions: t.common.actions,
          emptyTitle: t.products.emptyTitle,
          emptyDescription: t.products.emptyDescription,
          statusDraft: t.products.statusDraft,
          statusPublished: t.products.statusPublished,
          statusArchived: t.products.statusArchived,
          stockIn: t.products.stockIn,
          stockLow: t.products.stockLow,
          stockOut: t.products.stockOut,
          variantCount: t.products.variantCount,
          previousPage: t.products.previousPage,
          nextPage: t.products.nextPage,
          pageLabel: t.products.pageLabel,
          bulkToolbar: t.products.bulkToolbar,
          bulkClear: t.products.bulkClear,
          bulkSelected: t.products.bulkSelected,
          bulkPublish: t.products.bulkPublish,
          bulkArchive: t.products.bulkArchive,
          bulkDone: t.products.bulkDone,
          bulkPartial: t.products.bulkPartial,
          selectAll: t.products.selectAll,
          selectRow: t.products.selectRow,
        }}
      />
    </div>
  );
}
