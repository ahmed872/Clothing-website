'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/admin/data-table';
import { BulkActionBar } from '@/components/admin/bulk-action-bar';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Pagination } from '@/components/ui/pagination';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  applyBulkPriceAction,
  previewBulkPriceAction,
  updateVariantPriceAction,
} from '@/lib/admin/pricing-actions';
import { formatMoney, fromMinor, toMinor } from '@/modules/core/money';
import type { Locale } from '@/lib/i18n/locales';

export interface PricingTableRow {
  variantId: string;
  sku: string;
  variantLabel: string;
  productId: string;
  productName: string;
  priceMinor: number;
  compareAtMinor: number | null;
  /** ISO, for the optimistic-concurrency check on a single-row save. */
  updatedAt: string;
}

export interface PricingTableLabels {
  colVariant: string;
  colProduct: string;
  colSku: string;
  colPrice: string;
  colCompareAt: string;
  actions: string;
  emptyTitle: string;
  emptyDescription: string;
  save: string;
  saving: string;
  cancel: string;
  priceSaved: string;
  bulkOpen: string;
  bulkTitle: string;
  bulkMode: string;
  bulkAbsolute: string;
  bulkPercentage: string;
  bulkNewPrice: string;
  bulkPercent: string;
  bulkPercentHelp: string;
  bulkPreview: string;
  bulkPreviewing: string;
  bulkPreviewTitle: string;
  bulkColCurrent: string;
  bulkColNew: string;
  bulkApply: string;
  bulkApplying: string;
  bulkApplied: string;
  bulkBlocked: string;
  bulkToolbar: string;
  bulkClear: string;
  bulkSelected: string;
  selectAll: string;
  selectRow: string;
  previousPage: string;
  nextPage: string;
  pageLabel: string;
}

interface PreviewRow {
  variantId: string;
  sku: string;
  currentPriceMinor: number;
  newPriceMinor: number;
  problemReasonCode: string | null;
}

export function PricingTable({
  rows,
  page,
  pageCount,
  locale,
  canEdit,
  labels,
}: {
  rows: PricingTableRow[];
  page: number;
  pageCount: number;
  locale: Locale;
  /** `products.update`. Every action it gates is refused server-side too. */
  canEdit: boolean;
  labels: PricingTableLabels;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const columns: DataTableColumn<PricingTableRow>[] = [
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
  ];

  if (canEdit) {
    columns.push({
      key: 'edit',
      header: labels.colPrice,
      align: 'end',
      cell: (row) => (
        <PriceEditor row={row} locale={locale} labels={labels} onSaved={() => router.refresh()} />
      ),
    });
  } else {
    columns.push(
      {
        key: 'price',
        header: labels.colPrice,
        align: 'end',
        cell: (row) => <span>{formatMoney(row.priceMinor, { locale })}</span>,
      },
      {
        key: 'compareAt',
        header: labels.colCompareAt,
        align: 'end',
        cell: (row) =>
          row.compareAtMinor === null ? '—' : formatMoney(row.compareAtMinor, { locale }),
      },
    );
  }

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
        getRowId={(row) => row.variantId}
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
        <>
          <BulkActionBar
            selectedCount={selectedIds.size}
            onClear={() => setSelectedIds(new Set())}
            toolbarLabel={labels.bulkToolbar}
            clearLabel={labels.bulkClear}
            countLabel={(count) => labels.bulkSelected.replace('{count}', String(count))}
            actions={
              <Button size="sm" onClick={() => setBulkOpen(true)}>
                {labels.bulkOpen}
              </Button>
            }
          />

          <BulkPriceDialog
            open={bulkOpen}
            onOpenChange={setBulkOpen}
            variantIds={[...selectedIds]}
            locale={locale}
            labels={labels}
            onApplied={() => {
              setSelectedIds(new Set());
              router.refresh();
            }}
          />
        </>
      ) : null}
    </div>
  );
}

/** Price and compare-at, saved together: they are one invariant, and the
 * server checks the *resulting* pair, so raising a price past a stale
 * compare-at is refused rather than quietly stored. */
function PriceEditor({
  row,
  locale,
  labels,
  onSaved,
}: {
  row: PricingTableRow;
  locale: Locale;
  labels: PricingTableLabels;
  onSaved: () => void;
}) {
  const [price, setPrice] = useState(String(fromMinor(row.priceMinor)));
  const [compareAt, setCompareAt] = useState(
    row.compareAtMinor === null ? '' : String(fromMinor(row.compareAtMinor)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The version this editor is working against. Seeded from the server
  // render and advanced by each successful save: without that, a second
  // edit before the page refreshes would be refused as a conflict with the
  // admin's *own* previous save — the concurrency check protecting them
  // from themselves.
  const [version, setVersion] = useState(row.updatedAt);
  const [versionFor, setVersionFor] = useState(row.updatedAt);
  if (versionFor !== row.updatedAt) {
    setVersionFor(row.updatedAt);
    setVersion(row.updatedAt);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await updateVariantPriceAction(
      row.variantId,
      {
        priceMinor: toMinor(Number(price) || 0),
        compareAtMinor: compareAt === '' ? null : toMinor(Number(compareAt)),
      },
      version,
      locale,
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? null);
      return;
    }
    if (result.data) setVersion(result.data.updatedAt);
    toast({ title: labels.priceSaved, variant: 'success' });
    onSaved();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-2">
        <Input
          type="number"
          min={0}
          step="0.01"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          aria-label={`${labels.colPrice}: ${row.sku}`}
          className="w-28 tabular-nums"
        />
        <Input
          type="number"
          min={0}
          step="0.01"
          value={compareAt}
          onChange={(event) => setCompareAt(event.target.value)}
          aria-label={`${labels.colCompareAt}: ${row.sku}`}
          className="w-28 tabular-nums"
        />
        <Button size="sm" onClick={() => void save()} disabled={busy}>
          {busy ? labels.saving : labels.save}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-caption text-(--color-error)">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function BulkPriceDialog({
  open,
  onOpenChange,
  variantIds,
  locale,
  labels,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variantIds: string[];
  locale: Locale;
  labels: PricingTableLabels;
  onApplied: () => void;
}) {
  const [mode, setMode] = useState<'absolute' | 'percentage'>('percentage');
  const [value, setValue] = useState('');
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [blockedCount, setBlockedCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function operation() {
    const parsed = Number(value);
    return mode === 'absolute'
      ? ({ kind: 'absolute', priceMinor: toMinor(parsed) } as const)
      : ({ kind: 'percentage', percent: parsed } as const);
  }

  function reset(): void {
    setPreview(null);
    setBlockedCount(0);
    setError(null);
  }

  async function runPreview(): Promise<void> {
    if (value.trim() === '' || !Number.isFinite(Number(value))) return;
    setBusy(true);
    setError(null);
    // The numbers come from the server, computed by the same function that
    // will do the writing — never from arithmetic in this component, which
    // could round differently and show a price that never lands.
    const result = await previewBulkPriceAction(variantIds, operation(), locale);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? null);
      setPreview(null);
      return;
    }
    setPreview(result.data?.rows ?? []);
    setBlockedCount(result.data?.blockedCount ?? 0);
  }

  async function apply(): Promise<void> {
    setBusy(true);
    setError(null);
    // The operation is re-sent, not the previewed prices: the server
    // recomputes from the stored price inside its transaction, so a preview
    // that went stale cannot write a number nobody approved.
    const result = await applyBulkPriceAction(variantIds, operation(), locale);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? null);
      return;
    }
    toast({
      title: labels.bulkApplied.replace('{count}', String(result.data?.updated ?? 0)),
      variant: 'success',
    });
    reset();
    setValue('');
    onOpenChange(false);
    onApplied();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {labels.bulkTitle.replace('{count}', String(variantIds.length))}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {error ? (
            <Alert variant="error" role="alert">
              {error}
            </Alert>
          ) : null}

          <fieldset className="flex flex-col gap-2">
            <legend className="pb-1 text-sm font-medium text-(--color-text)">
              {labels.bulkMode}
            </legend>
            <RadioGroup
              value={mode}
              onValueChange={(next) => {
                setMode(next as 'absolute' | 'percentage');
                reset();
              }}
              className="flex flex-wrap gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="percentage" id="bulk-mode-percentage" />
                <Label htmlFor="bulk-mode-percentage">{labels.bulkPercentage}</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="absolute" id="bulk-mode-absolute" />
                <Label htmlFor="bulk-mode-absolute">{labels.bulkAbsolute}</Label>
              </div>
            </RadioGroup>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-value">
              {mode === 'absolute' ? labels.bulkNewPrice : labels.bulkPercent}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="bulk-value"
                type="number"
                step={mode === 'absolute' ? '0.01' : '1'}
                {...(mode === 'absolute' ? { min: 0 } : {})}
                dir="ltr"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  reset();
                }}
                className="w-40 tabular-nums"
                aria-describedby={mode === 'percentage' ? 'bulk-value-help' : undefined}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void runPreview()}
                disabled={busy}
              >
                {busy && preview === null ? labels.bulkPreviewing : labels.bulkPreview}
              </Button>
            </div>
            {mode === 'percentage' ? (
              <p id="bulk-value-help" className="text-caption text-(--color-text-muted)">
                {labels.bulkPercentHelp}
              </p>
            ) : null}
          </div>

          {preview ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-(--color-text)">{labels.bulkPreviewTitle}</h3>
              {blockedCount > 0 ? (
                <Alert variant="warning" role="status">
                  {labels.bulkBlocked.replace('{count}', String(blockedCount))}
                </Alert>
              ) : null}
              <div className="max-h-64 overflow-y-auto rounded-(--radius-surface) border border-(--color-border)">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-(--color-surface-raised)">
                    <tr className="border-b border-(--color-border)">
                      <th className="p-2 text-start font-medium">{labels.colSku}</th>
                      <th className="p-2 text-end font-medium">{labels.bulkColCurrent}</th>
                      <th className="p-2 text-end font-medium">{labels.bulkColNew}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr
                        key={row.variantId}
                        className="border-b border-(--color-border) last:border-b-0"
                      >
                        <td className="p-2" dir="ltr">
                          {row.sku}
                        </td>
                        <td className="p-2 text-end tabular-nums">
                          {formatMoney(row.currentPriceMinor, { locale })}
                        </td>
                        <td
                          className={
                            row.problemReasonCode
                              ? 'p-2 text-end font-medium text-(--color-error) tabular-nums'
                              : 'p-2 text-end font-medium tabular-nums'
                          }
                        >
                          {formatMoney(row.newPriceMinor, { locale })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button
            type="button"
            onClick={() => void apply()}
            loading={busy && preview !== null}
            disabled={busy || preview === null || blockedCount > 0}
          >
            {busy && preview !== null ? labels.bulkApplying : labels.bulkApply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
