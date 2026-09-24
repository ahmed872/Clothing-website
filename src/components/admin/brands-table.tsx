'use client';

import Link from 'next/link';

import type { Locale } from '@/lib/i18n/locales';
import { DataTable, type DataTableColumn } from '@/components/admin/data-table';
import { BrandRowActions } from '@/components/admin/brand-row-actions';

export interface BrandTableRow {
  id: string;
  nameAr: string;
  nameEn: string;
  slug: string;
  productCount: number;
}

export interface BrandsTableLabels {
  colName: string;
  colSlug: string;
  colProducts: string;
  actions: string;
  emptyTitle: string;
  emptyDescription: string;
  edit: string;
  delete: string;
  confirmDeleteTitle: string;
  deleteConfirmDescription: string;
  cancel: string;
  confirm: string;
  deletedSuccessfully: string;
}

/**
 * `DataTable`'s `columns`/`getRowId` are functions (cell renderers) — they
 * cannot cross the Server → Client Component boundary as props (React
 * serializes props passed *into* a Client Component, and a function isn't
 * serializable). So the table itself, cell renderers included, has to be
 * built here, client-side, from the plain, serializable `rows` data the
 * server page fetched — the same shape every other P07 list table follows.
 */
export function BrandsTable({
  rows,
  locale,
  labels,
}: {
  rows: BrandTableRow[];
  locale: Locale;
  labels: BrandsTableLabels;
}) {
  const columns: DataTableColumn<BrandTableRow>[] = [
    {
      key: 'name',
      header: labels.colName,
      cell: (row) => (
        <Link
          href={`/admin/brands/${row.id}`}
          className="font-medium text-(--color-text) hover:underline"
        >
          {locale === 'ar' ? row.nameAr : row.nameEn}
        </Link>
      ),
    },
    {
      key: 'slug',
      header: labels.colSlug,
      cell: (row) => <span className="text-(--color-text-muted) tabular-nums">{row.slug}</span>,
    },
    {
      key: 'products',
      header: labels.colProducts,
      align: 'end',
      cell: (row) => <span className="tabular-nums">{row.productCount}</span>,
    },
    {
      key: 'actions',
      header: labels.actions,
      align: 'end',
      cell: (row) => (
        <BrandRowActions
          brandId={row.id}
          locale={locale}
          labels={{
            edit: labels.edit,
            delete: labels.delete,
            confirmDeleteTitle: labels.confirmDeleteTitle,
            deleteConfirmDescription: labels.deleteConfirmDescription,
            cancel: labels.cancel,
            confirm: labels.confirm,
            deletedSuccessfully: labels.deletedSuccessfully,
          }}
        />
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      emptyTitle={labels.emptyTitle}
      emptyDescription={labels.emptyDescription}
      selectAllLabel={labels.actions}
      selectRowLabel={labels.actions}
    />
  );
}
