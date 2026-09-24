'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Pause, Play, Trash2 } from 'lucide-react';

import { DataTable, type DataTableColumn } from '@/components/admin/data-table';
import { StatusBadge, type StatusTone } from '@/components/admin/status-badge';
import { ConfirmationDialog } from '@/components/admin/confirmation-dialog';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { toast } from '@/components/ui/toast';
import { deletePromotionAction, setPromotionActiveAction } from '@/lib/admin/promotion-actions';
import type { Locale } from '@/lib/i18n/locales';

export type PromotionStatus = 'active' | 'inactive' | 'scheduled' | 'expired';

export interface PromotionRow {
  id: string;
  code: string;
  type: 'PERCENTAGE' | 'FIXED';
  /** Pre-formatted server-side: a percentage and an amount are different
   * shapes, and money formatting needs the store's currency. */
  valueLabel: string;
  minOrderLabel: string | null;
  usageLabel: string;
  windowLabel: string;
  status: PromotionStatus;
  scopeCount: number;
  redemptionCount: number;
}

export interface PromotionsTableLabels {
  colCode: string;
  colType: string;
  colValue: string;
  colUsage: string;
  colWindow: string;
  colStatus: string;
  actions: string;
  emptyTitle: string;
  emptyDescription: string;
  typePercentage: string;
  typeFixed: string;
  statusActive: string;
  statusInactive: string;
  statusScheduled: string;
  statusExpired: string;
  activate: string;
  deactivate: string;
  activated: string;
  deactivated: string;
  deleted: string;
  delete: string;
  confirmDeleteTitle: string;
  deleteConfirmDescription: string;
  cancel: string;
  confirm: string;
  previousPage: string;
  nextPage: string;
  pageLabel: string;
}

const STATUS_TONE: Record<PromotionStatus, StatusTone> = {
  active: 'success',
  inactive: 'neutral',
  scheduled: 'info',
  expired: 'warning',
};

export function PromotionsTable({
  rows,
  page,
  pageCount,
  locale,
  labels,
}: {
  rows: PromotionRow[];
  page: number;
  pageCount: number;
  locale: Locale;
  labels: PromotionsTableLabels;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PromotionRow | null>(null);

  const statusLabel: Record<PromotionStatus, string> = {
    active: labels.statusActive,
    inactive: labels.statusInactive,
    scheduled: labels.statusScheduled,
    expired: labels.statusExpired,
  };

  async function toggleActive(row: PromotionRow): Promise<void> {
    const next = row.status === 'inactive';
    setBusy(row.id);
    setError(null);
    const result = await setPromotionActiveAction(row.id, next, locale);
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? null);
      return;
    }
    toast({ title: next ? labels.activated : labels.deactivated, variant: 'success' });
    router.refresh();
  }

  async function remove(row: PromotionRow): Promise<void> {
    setBusy(row.id);
    setError(null);
    const result = await deletePromotionAction(row.id, locale);
    setBusy(null);
    setConfirmDelete(null);
    if (!result.ok) {
      setError(result.error ?? null);
      return;
    }
    toast({ title: labels.deleted, variant: 'success' });
    router.refresh();
  }

  const columns: DataTableColumn<PromotionRow>[] = [
    {
      key: 'code',
      header: labels.colCode,
      cell: (row) => (
        <Link
          href={`/admin/promotions/${row.id}`}
          // A promotion code is a code: one LTR run in both languages.
          dir="ltr"
          className="inline-block font-medium text-(--color-text) hover:underline"
        >
          {row.code}
        </Link>
      ),
    },
    {
      key: 'type',
      header: labels.colType,
      cell: (row) => (row.type === 'PERCENTAGE' ? labels.typePercentage : labels.typeFixed),
    },
    {
      key: 'value',
      header: labels.colValue,
      align: 'end',
      cell: (row) => (
        <span dir="ltr" className="inline-block tabular-nums">
          {row.valueLabel}
        </span>
      ),
    },
    {
      key: 'usage',
      header: labels.colUsage,
      align: 'end',
      cell: (row) => (
        <span dir="ltr" className="inline-block text-(--color-text-muted) tabular-nums">
          {row.usageLabel}
        </span>
      ),
    },
    {
      key: 'window',
      header: labels.colWindow,
      // Dates carry bidi marks in Arabic; one LTR run keeps them readable.
      cell: (row) => (
        <span dir="ltr" className="inline-block text-(--color-text-muted) tabular-nums">
          {row.windowLabel}
        </span>
      ),
    },
    {
      key: 'status',
      header: labels.colStatus,
      cell: (row) => <StatusBadge label={statusLabel[row.status]} tone={STATUS_TONE[row.status]} />,
    },
    {
      key: 'actions',
      header: labels.actions,
      align: 'end',
      cell: (row) => (
        <div className="relative flex items-center justify-end gap-1">
          <Button
            size="icon"
            variant="ghost"
            disabled={busy === row.id}
            aria-label={`${row.status === 'inactive' ? labels.activate : labels.deactivate}: ${row.code}`}
            onClick={() => void toggleActive(row)}
          >
            {row.status === 'inactive' ? (
              <Play className="size-4" aria-hidden="true" />
            ) : (
              <Pause className="size-4" aria-hidden="true" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={busy === row.id}
            aria-label={`${labels.delete}: ${row.code}`}
            onClick={() => setConfirmDelete(row)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
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
      {error ? (
        <Alert variant="error" role="alert">
          {error}
        </Alert>
      ) : null}

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

      <ConfirmationDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title={labels.confirmDeleteTitle}
        description={labels.deleteConfirmDescription}
        confirmLabel={labels.delete}
        cancelLabel={labels.cancel}
        destructive
        onConfirm={() => {
          if (confirmDelete) void remove(confirmDelete);
        }}
      />
    </div>
  );
}
