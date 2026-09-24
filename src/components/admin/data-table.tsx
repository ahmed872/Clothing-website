'use client';

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface DataTableColumn<Row> {
  key: string;
  header: string;
  cell: (row: Row) => React.ReactNode;
  /** Right-aligns in LTR, left-aligns in RTL — for numeric/price columns. */
  align?: 'start' | 'end';
  sortable?: boolean;
}

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowId: (row: Row) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  selectedIds?: Set<string>;
  onSelectedIdsChange?: (ids: Set<string>) => void;
  sortKey?: string;
  sortDirection?: 'asc' | 'desc';
  onSortChange?: (key: string) => void;
  className?: string;
  /** Every string here defaults to Arabic (the store default locale) and can be overridden per call site for English. */
  selectAllLabel?: string;
  selectRowLabel?: string;
}

/**
 * The one table implementation every admin list screen (products, orders,
 * customers, …) builds on: selection, sorting affordance and loading/empty
 * states are handled once here instead of once per screen.
 */
export function DataTable<Row>({
  columns,
  rows,
  getRowId,
  loading = false,
  emptyTitle = 'لا توجد بيانات',
  emptyDescription,
  selectedIds,
  onSelectedIdsChange,
  sortKey,
  sortDirection,
  onSortChange,
  className,
  selectAllLabel = 'تحديد كل الصفوف',
  selectRowLabel = 'تحديد الصف',
}: DataTableProps<Row>) {
  const selectable = selectedIds !== undefined && onSelectedIdsChange !== undefined;
  const allSelected =
    selectable && rows.length > 0 && rows.every((row) => selectedIds!.has(getRowId(row)));

  function toggleAll() {
    if (!selectable) return;
    onSelectedIdsChange!(allSelected ? new Set() : new Set(rows.map(getRowId)));
  }

  function toggleRow(id: string) {
    if (!selectable) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedIdsChange!(next);
  }

  if (!loading && rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} className={className} />;
  }

  return (
    <Table className={className}>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {selectable ? (
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected}
                onCheckedChange={toggleAll}
                aria-label={selectAllLabel}
              />
            </TableHead>
          ) : null}
          {columns.map((column) => (
            <TableHead key={column.key} className={column.align === 'end' ? 'text-end' : undefined}>
              {column.sortable ? (
                <button
                  type="button"
                  onClick={() => onSortChange?.(column.key)}
                  className="inline-flex items-center gap-1 uppercase hover:text-(--color-text)"
                >
                  {column.header}
                  {sortKey === column.key ? (
                    sortDirection === 'asc' ? (
                      <ArrowUp className="size-3.5" aria-hidden="true" />
                    ) : (
                      <ArrowDown className="size-3.5" aria-hidden="true" />
                    )
                  ) : (
                    <ArrowUpDown className="size-3.5 opacity-40" aria-hidden="true" />
                  )}
                </button>
              ) : (
                column.header
              )}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading
          ? Array.from({ length: 5 }, (_, i) => (
              <TableRow key={i} className="hover:bg-transparent">
                {selectable ? (
                  <TableCell>
                    <Skeleton className="size-4.5" />
                  </TableCell>
                ) : null}
                {columns.map((column) => (
                  <TableCell key={column.key}>
                    <Skeleton className="h-4 w-full max-w-32" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          : rows.map((row) => {
              const id = getRowId(row);
              return (
                <TableRow
                  key={id}
                  data-state={selectedIds?.has(id) ? 'selected' : undefined}
                  className="data-[state=selected]:bg-(--color-secondary)"
                >
                  {selectable ? (
                    <TableCell>
                      <Checkbox
                        checked={selectedIds!.has(id)}
                        onCheckedChange={() => toggleRow(id)}
                        aria-label={selectRowLabel}
                      />
                    </TableCell>
                  ) : null}
                  {columns.map((column) => (
                    <TableCell
                      key={column.key}
                      className={cn(column.align === 'end' && 'text-end tabular-nums')}
                    >
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
      </TableBody>
    </Table>
  );
}
