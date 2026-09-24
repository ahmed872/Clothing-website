'use client';

import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

import { useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/admin/data-table';
import { BulkActionBar } from '@/components/admin/bulk-action-bar';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { toast } from '@/components/ui/toast';
import { bulkProductStatusAction } from '@/lib/admin/product-actions';
import { StatusBadge, type StatusTone } from '@/components/admin/status-badge';
import { Pagination } from '@/components/ui/pagination';
import type { Locale } from '@/lib/i18n/locales';

export type ProductRowStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type ProductRowStock = 'in-stock' | 'low-stock' | 'out-of-stock' | null;

export interface ProductTableRow {
  id: string;
  name: string;
  skuSummary: string;
  variantCount: number;
  categoryName: string | null;
  brandName: string | null;
  /** Pre-formatted server-side: money formatting needs the store's currency
   * and exponent, which live in the domain, not in a table cell. */
  price: string | null;
  compareAtPrice: string | null;
  stockStatus: ProductRowStock;
  status: ProductRowStatus;
  updatedAt: string;
}

export interface ProductsTableLabels {
  colProduct: string;
  colSku: string;
  colCategory: string;
  colBrand: string;
  colPrice: string;
  colStock: string;
  status: string;
  updatedAt: string;
  actions: string;
  emptyTitle: string;
  emptyDescription: string;
  statusDraft: string;
  statusPublished: string;
  statusArchived: string;
  stockIn: string;
  stockLow: string;
  stockOut: string;
  variantCount: string;
  previousPage: string;
  nextPage: string;
  pageLabel: string;
  bulkToolbar: string;
  bulkClear: string;
  bulkSelected: string;
  bulkPublish: string;
  bulkArchive: string;
  bulkDone: string;
  bulkPartial: string;
  selectAll: string;
  selectRow: string;
}

const STATUS_TONE: Record<ProductRowStatus, StatusTone> = {
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  ARCHIVED: 'warning',
};

const STOCK_TONE: Record<Exclude<ProductRowStock, null>, StatusTone> = {
  'in-stock': 'success',
  'low-stock': 'warning',
  'out-of-stock': 'error',
};

export function ProductsTable({
  rows,
  page,
  pageCount,
  locale,
  canEdit,
  labels,
}: {
  rows: ProductTableRow[];
  page: number;
  pageCount: number;
  locale: Locale;
  /** `products.update`. Selection, the bulk bar, and the row link's target
   * all follow it: a role that can only read lands on the read-only
   * preview instead of an edit page it would be refused. The server checks
   * the permission again on every one of those routes regardless. */
  canEdit: boolean;
  labels: ProductsTableLabels;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  async function runBulk(operation: 'publish' | 'archive'): Promise<void> {
    setBulkBusy(true);
    setBulkError(null);
    const result = await bulkProductStatusAction([...selectedIds], operation, locale);
    setBulkBusy(false);

    if (!result.ok) {
      setBulkError(result.error ?? null);
      return;
    }
    const { succeeded, failures } = result.data ?? { succeeded: 0, failures: [] };
    if (failures.length > 0) {
      // A partial result is not a success: the banner names how many were
      // refused and why, since "3 of 10" without a reason is unactionable.
      setBulkError(
        `${labels.bulkPartial
          .replace('{count}', String(succeeded))
          .replace('{failed}', String(failures.length))} ${failures[0]?.error ?? ''}`,
      );
    } else {
      toast({
        title: labels.bulkDone.replace('{count}', String(succeeded)),
        variant: 'success',
      });
    }
    setSelectedIds(new Set());
    router.refresh();
  }

  const statusLabel: Record<ProductRowStatus, string> = {
    DRAFT: labels.statusDraft,
    PUBLISHED: labels.statusPublished,
    ARCHIVED: labels.statusArchived,
  };
  const stockLabel: Record<Exclude<ProductRowStock, null>, string> = {
    'in-stock': labels.stockIn,
    'low-stock': labels.stockLow,
    'out-of-stock': labels.stockOut,
  };

  const columns: DataTableColumn<ProductTableRow>[] = [
    {
      key: 'product',
      header: labels.colProduct,
      cell: (row) => (
        <Link
          href={canEdit ? `/admin/products/${row.id}` : `/admin/products/${row.id}/preview`}
          className="font-medium text-(--color-text) hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: 'sku',
      header: labels.colSku,
      cell: (row) => (
        <span className="text-(--color-text-muted) tabular-nums">{row.skuSummary}</span>
      ),
    },
    {
      key: 'category',
      header: labels.colCategory,
      cell: (row) => row.categoryName ?? '—',
    },
    {
      key: 'brand',
      header: labels.colBrand,
      cell: (row) => row.brandName ?? '—',
    },
    {
      key: 'price',
      header: labels.colPrice,
      align: 'end',
      cell: (row) =>
        row.price ? (
          <span className="inline-flex items-center gap-2 tabular-nums">
            <span>{row.price}</span>
            {/* `--color-text-muted`, not `--color-text-subtle`: the subtle
                token is ≈3.1:1 on this background — fine for a placeholder
                or an icon, not for a price an admin has to read. */}
            {row.compareAtPrice ? (
              <s className="text-(--color-text-muted)">{row.compareAtPrice}</s>
            ) : null}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'stock',
      header: labels.colStock,
      cell: (row) =>
        row.stockStatus ? (
          <StatusBadge label={stockLabel[row.stockStatus]} tone={STOCK_TONE[row.stockStatus]} />
        ) : (
          '—'
        ),
    },
    {
      key: 'status',
      header: labels.status,
      cell: (row) => <StatusBadge label={statusLabel[row.status]} tone={STATUS_TONE[row.status]} />,
    },
    {
      key: 'updatedAt',
      header: labels.updatedAt,
      align: 'end',
      // `dir="ltr"`: the Arabic date format carries RTL marks between its
      // parts (01<RLM>/09<RLM>/2026), which reorder into an unreadable
      // "012026/09/" inside an RTL cell. A numeric date is one LTR run in
      // both locales — the same reasoning ADR-023 applies to digits.
      cell: (row) => (
        <span dir="ltr" className="inline-block text-(--color-text-muted) tabular-nums">
          {row.updatedAt}
        </span>
      ),
    },
  ];

  function goToPage(next: number): void {
    const params = new URLSearchParams(searchParams.toString());
    if (next <= 1) params.delete('page');
    else params.set('page', String(next));
    const search = params.toString();
    router.push(search ? `${pathname}?${search}` : pathname);
  }

  return (
    <div className="flex flex-col gap-4">
      {bulkError ? (
        <Alert variant="error" role="alert">
          {bulkError}
        </Alert>
      ) : null}

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        emptyTitle={labels.emptyTitle}
        emptyDescription={labels.emptyDescription}
        selectAllLabel={labels.selectAll}
        selectRowLabel={labels.selectRow}
        {...(canEdit ? { selectedIds, onSelectedIdsChange: setSelectedIds } : {})}
      />

      {pageCount > 1 ? (
        <Pagination
          page={page}
          pageCount={pageCount}
          onPageChange={goToPage}
          className="justify-end"
          labels={{
            previous: labels.previousPage,
            next: labels.nextPage,
            page: (n) => labels.pageLabel.replace('{n}', String(n)),
          }}
        />
      ) : null}

      {canEdit ? (
        <BulkActionBar
          selectedCount={selectedIds.size}
          onClear={() => setSelectedIds(new Set())}
          toolbarLabel={labels.bulkToolbar}
          clearLabel={labels.bulkClear}
          countLabel={(count) => labels.bulkSelected.replace('{count}', String(count))}
          actions={
            <>
              <Button size="sm" disabled={bulkBusy} onClick={() => void runBulk('publish')}>
                {labels.bulkPublish}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={bulkBusy}
                onClick={() => void runBulk('archive')}
              >
                {labels.bulkArchive}
              </Button>
            </>
          }
        />
      ) : null}
    </div>
  );
}
