'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { DataTable, type DataTableColumn } from '@/components/admin/data-table';
import { Pagination } from '@/components/ui/pagination';

export interface InventoryHistoryRow {
  id: string;
  /** Pre-formatted server-side by `formatAdminDate`, which strips the
   * bidi marks Arabic date formatting embeds between the parts. */
  when: string;
  delta: number;
  previousQuantity: number;
  newQuantity: number;
  reason: string;
  note: string | null;
  actor: string;
  sku: string;
  productId: string;
  productName: string;
  variantLabel: string;
}

export interface InventoryHistoryLabels {
  colWhen: string;
  colVariant: string;
  colSku: string;
  colBefore: string;
  colChange: string;
  colAfter: string;
  colReason: string;
  colActor: string;
  colNote: string;
  emptyTitle: string;
  emptyDescription: string;
  previousPage: string;
  nextPage: string;
  pageLabel: string;
}

export function InventoryHistoryTable({
  rows,
  page,
  pageCount,
  labels,
}: {
  rows: InventoryHistoryRow[];
  page: number;
  pageCount: number;
  labels: InventoryHistoryLabels;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const columns: DataTableColumn<InventoryHistoryRow>[] = [
    {
      key: 'when',
      header: labels.colWhen,
      // `dir="ltr"`: a numeric date is one LTR run in both locales, and an
      // RTL cell would otherwise reorder its parts.
      cell: (row) => (
        <span dir="ltr" className="inline-block text-(--color-text-muted) tabular-nums">
          {row.when}
        </span>
      ),
    },
    {
      key: 'variant',
      header: labels.colVariant,
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-medium text-(--color-text)">{row.variantLabel}</span>
          <Link
            href={`/admin/products/${row.productId}`}
            className="text-caption text-(--color-text-muted) hover:underline"
          >
            {row.productName}
          </Link>
        </div>
      ),
    },
    {
      key: 'sku',
      header: labels.colSku,
      cell: (row) => (
        <span dir="ltr" className="inline-block text-(--color-text-muted) tabular-nums">
          {row.sku}
        </span>
      ),
    },
    {
      key: 'before',
      header: labels.colBefore,
      align: 'end',
      cell: (row) => <span className="tabular-nums">{row.previousQuantity}</span>,
    },
    {
      key: 'change',
      header: labels.colChange,
      align: 'end',
      // A signed number is an LTR run: in an RTL cell the sign would drift
      // to the wrong end of the digits and read as the opposite movement.
      cell: (row) => (
        <span
          dir="ltr"
          className={
            row.delta > 0
              ? 'inline-block font-medium text-(--color-success) tabular-nums'
              : 'inline-block font-medium text-(--color-error) tabular-nums'
          }
        >
          {row.delta > 0 ? `+${row.delta}` : row.delta}
        </span>
      ),
    },
    {
      key: 'after',
      header: labels.colAfter,
      align: 'end',
      cell: (row) => <span className="font-medium tabular-nums">{row.newQuantity}</span>,
    },
    { key: 'reason', header: labels.colReason, cell: (row) => row.reason },
    {
      key: 'actor',
      header: labels.colActor,
      cell: (row) => <span className="text-(--color-text-muted)">{row.actor}</span>,
    },
    {
      key: 'note',
      header: labels.colNote,
      cell: (row) =>
        row.note ? (
          <span className="text-(--color-text-muted)">{row.note}</span>
        ) : (
          <span className="text-(--color-text-muted)">—</span>
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
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        emptyTitle={labels.emptyTitle}
        emptyDescription={labels.emptyDescription}
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
    </div>
  );
}
