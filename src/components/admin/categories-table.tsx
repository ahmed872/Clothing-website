'use client';

import Link from 'next/link';

import type { Locale } from '@/lib/i18n/locales';
import { DataTable, type DataTableColumn } from '@/components/admin/data-table';
import { CategoryRowActions } from '@/components/admin/category-row-actions';

export interface CategoryTableRow {
  id: string;
  nameAr: string;
  nameEn: string;
  slug: string;
  depth: number;
  productCount: number;
}

export interface CategoriesTableLabels {
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
 * A flat, indentation-by-depth list rather than a drag-and-drop tree
 * widget — P07 §12 explicitly asks for "no heavy library without reason"
 * and prioritizes mobile usability over flashy interaction; indentation
 * alone already conveys the hierarchy, and reordering/reparenting is a
 * plain form field (`CategoryForm`'s parent `Select` + position number),
 * not a drag gesture.
 */
export function CategoriesTable({
  rows,
  locale,
  labels,
}: {
  rows: CategoryTableRow[];
  locale: Locale;
  labels: CategoriesTableLabels;
}) {
  const columns: DataTableColumn<CategoryTableRow>[] = [
    {
      key: 'name',
      header: labels.colName,
      cell: (row) => (
        <Link
          href={`/admin/categories/${row.id}`}
          className="font-medium text-(--color-text) hover:underline"
          style={{ paddingInlineStart: `${row.depth * 1.25}rem` }}
        >
          {row.depth > 0 ? <span className="text-(--color-text-muted)">— </span> : null}
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
        <CategoryRowActions
          categoryId={row.id}
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
