import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { History } from 'lucide-react';
import type { ProductStatus } from '@generated/prisma';

import {
  getCategoryTree,
  listVariantsForAdmin,
  type CategoryNode,
  type VariantListingSort,
  type VariantStockFilter,
} from '@/modules/catalog';
import { roleHasPermission } from '@/modules/identity';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale, type Locale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { QueryToolbar, type QueryToolbarOption } from '@/components/admin/query-toolbar';
import {
  InventoryTable,
  type InventoryRowStatus,
  type InventoryTableRow,
} from '@/components/admin/inventory-table';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Inventory' };

const SORTS: VariantListingSort[] = ['stock-asc', 'stock-desc', 'sku-asc', 'updated-desc'];
const STOCKS: VariantStockFilter[] = ['in_stock', 'low_stock', 'out_of_stock', 'untracked'];
const STATUSES: ProductStatus[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

/** A query string is user input. Every value is matched against what the
 * domain actually accepts before it reaches the service, so a hand-edited
 * URL can only produce a valid query or fall back to the default — never an
 * unhandled error, and never an unfiltered dump of the whole catalog. */
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

export default async function AdminInventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAdminPermission('inventory.read');

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
      stock: STOCKS.find((stock) => stock === one('stock')),
      sort: SORTS.find((sort) => sort === one('sort')) ?? 'stock-asc',
      page: parsePositiveInt(one('page')) ?? 1,
    }),
    getCategoryTree(),
  ]);

  const rows: InventoryTableRow[] = result.items.map((item) => {
    // The storefront's three states plus the one only an admin needs: an
    // untracked variant is "available" to a customer but is not a count.
    const status: InventoryRowStatus = item.trackInventory ? item.stockStatus : 'untracked';
    const variantLabel = locale === 'ar' ? item.variantLabelAr : item.variantLabelEn;
    return {
      variantId: item.variantId,
      sku: item.sku,
      variantLabel: variantLabel || item.sku,
      productId: item.productId,
      productName: locale === 'ar' ? item.productNameAr : item.productNameEn,
      stockQuantity: item.stockQuantity,
      lowStockThreshold: item.lowStockThreshold,
      trackInventory: item.trackInventory,
      status,
      updatedAt: item.updatedAt.toISOString(),
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.inventory.title}
        description={t.inventory.resultCount.replace('{count}', String(result.total))}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[{ label: t.inventory.title }]}
          />
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/admin/inventory/history">
              <History className="size-4" aria-hidden="true" />
              {t.inventory.history}
            </Link>
          </Button>
        }
      />

      <QueryToolbar
        searchKey="q"
        searchPlaceholder={t.inventory.searchPlaceholder}
        labels={{
          allOption: t.inventory.allOption,
          clearAll: t.products.clearAll,
          removeFilter: t.products.removeFilter,
        }}
        selects={[
          {
            key: 'stock',
            label: t.inventory.filterStock,
            options: [
              { value: 'in_stock', label: t.inventory.statusIn },
              { value: 'low_stock', label: t.inventory.statusLow },
              { value: 'out_of_stock', label: t.inventory.statusOut },
              { value: 'untracked', label: t.inventory.statusUntracked },
            ],
          },
          {
            key: 'categoryId',
            label: t.inventory.filterCategory,
            options: flattenCategories(categoryTree, locale),
          },
          {
            key: 'status',
            label: t.inventory.filterStatus,
            options: [
              { value: 'DRAFT', label: t.products.statusDraft },
              { value: 'PUBLISHED', label: t.products.statusPublished },
              { value: 'ARCHIVED', label: t.products.statusArchived },
            ],
          },
          {
            key: 'sort',
            label: t.inventory.sort,
            includeAll: false,
            options: [
              { value: 'stock-asc', label: t.inventory.sortStockAsc },
              { value: 'stock-desc', label: t.inventory.sortStockDesc },
              { value: 'sku-asc', label: t.inventory.sortSkuAsc },
              { value: 'updated-desc', label: t.inventory.sortUpdatedDesc },
            ],
          },
        ]}
      />

      <InventoryTable
        rows={rows}
        page={result.page}
        pageCount={result.pageCount}
        locale={locale}
        canAdjust={roleHasPermission(user.role, 'inventory.adjust')}
        labels={{
          colVariant: t.inventory.colVariant,
          colProduct: t.inventory.colProduct,
          colSku: t.inventory.colSku,
          colStock: t.inventory.colStock,
          colThreshold: t.inventory.colThreshold,
          colStatus: t.inventory.colStatus,
          actions: t.common.actions,
          statusIn: t.inventory.statusIn,
          statusLow: t.inventory.statusLow,
          statusOut: t.inventory.statusOut,
          statusUntracked: t.inventory.statusUntracked,
          emptyTitle: t.inventory.emptyTitle,
          emptyDescription: t.inventory.emptyDescription,
          adjust: t.inventory.adjust,
          adjustTitle: t.inventory.adjustTitle,
          adjustCurrent: t.inventory.adjustCurrent,
          mode: t.inventory.mode,
          modeDelta: t.inventory.modeDelta,
          modeSet: t.inventory.modeSet,
          deltaLabel: t.inventory.deltaLabel,
          deltaHelp: t.inventory.deltaHelp,
          setToLabel: t.inventory.setToLabel,
          setToHelp: t.inventory.setToHelp,
          reason: t.inventory.reason,
          reasonRESTOCK: t.inventory.reasonRESTOCK,
          reasonRETURN: t.inventory.reasonRETURN,
          reasonDAMAGED: t.inventory.reasonDAMAGED,
          reasonCORRECTION: t.inventory.reasonCORRECTION,
          reasonMANUAL: t.inventory.reasonMANUAL,
          note: t.inventory.note,
          noteHelp: t.inventory.noteHelp,
          adjusted: t.inventory.adjusted,
          policy: t.inventory.policy,
          policyTitle: t.inventory.policyTitle,
          trackInventory: t.inventory.trackInventory,
          trackInventoryHelp: t.inventory.trackInventoryHelp,
          lowStockThreshold: t.inventory.lowStockThreshold,
          lowStockThresholdHelp: t.inventory.lowStockThresholdHelp,
          policySaved: t.inventory.policySaved,
          save: t.common.save,
          saving: t.common.saving,
          cancel: t.common.cancel,
          previousPage: t.inventory.previousPage,
          nextPage: t.inventory.nextPage,
          pageLabel: t.inventory.pageLabel,
        }}
      />
    </div>
  );
}
