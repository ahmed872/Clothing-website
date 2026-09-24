'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { PackagePlus, SlidersHorizontal } from 'lucide-react';

import { DataTable, type DataTableColumn } from '@/components/admin/data-table';
import { StatusBadge, type StatusTone } from '@/components/admin/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Pagination } from '@/components/ui/pagination';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { adjustStockAction, setInventoryPolicyAction } from '@/lib/admin/inventory-actions';
import type { Locale } from '@/lib/i18n/locales';

/** The four states an admin needs, which is one more than the storefront's:
 * a customer only cares whether they can buy it, but "not tracked" and "in
 * stock" mean very different things to whoever counts the shelf. Derived
 * from the same `resolveVariantStockStatus` the store uses, so the two can
 * never disagree about the three they share. */
export type InventoryRowStatus = 'in-stock' | 'low-stock' | 'out-of-stock' | 'untracked';

export type InventoryReason = 'RESTOCK' | 'RETURN' | 'DAMAGED' | 'CORRECTION' | 'MANUAL';

export interface InventoryTableRow {
  variantId: string;
  sku: string;
  variantLabel: string;
  productId: string;
  productName: string;
  stockQuantity: number;
  lowStockThreshold: number;
  trackInventory: boolean;
  status: InventoryRowStatus;
  /** ISO, for the optimistic-concurrency check when saving tracking settings. */
  updatedAt: string;
}

export interface InventoryTableLabels {
  colVariant: string;
  colProduct: string;
  colSku: string;
  colStock: string;
  colThreshold: string;
  colStatus: string;
  actions: string;
  statusIn: string;
  statusLow: string;
  statusOut: string;
  statusUntracked: string;
  emptyTitle: string;
  emptyDescription: string;
  adjust: string;
  adjustTitle: string;
  adjustCurrent: string;
  mode: string;
  modeDelta: string;
  modeSet: string;
  deltaLabel: string;
  deltaHelp: string;
  setToLabel: string;
  setToHelp: string;
  reason: string;
  reasonRESTOCK: string;
  reasonRETURN: string;
  reasonDAMAGED: string;
  reasonCORRECTION: string;
  reasonMANUAL: string;
  note: string;
  noteHelp: string;
  adjusted: string;
  policy: string;
  policyTitle: string;
  trackInventory: string;
  trackInventoryHelp: string;
  lowStockThreshold: string;
  lowStockThresholdHelp: string;
  policySaved: string;
  save: string;
  saving: string;
  cancel: string;
  previousPage: string;
  nextPage: string;
  pageLabel: string;
}

const STATUS_TONE: Record<InventoryRowStatus, StatusTone> = {
  'in-stock': 'success',
  'low-stock': 'warning',
  'out-of-stock': 'error',
  untracked: 'neutral',
};

const REASONS: InventoryReason[] = ['RESTOCK', 'RETURN', 'DAMAGED', 'CORRECTION', 'MANUAL'];

export function InventoryTable({
  rows,
  page,
  pageCount,
  locale,
  canAdjust,
  labels,
}: {
  rows: InventoryTableRow[];
  page: number;
  pageCount: number;
  locale: Locale;
  /** `inventory.adjust`. The dialogs it hides are also refused server-side
   * on every call — this only decides whether it is worth offering. */
  canAdjust: boolean;
  labels: InventoryTableLabels;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [adjusting, setAdjusting] = useState<InventoryTableRow | null>(null);
  const [editingPolicy, setEditingPolicy] = useState<InventoryTableRow | null>(null);

  const statusLabel: Record<InventoryRowStatus, string> = {
    'in-stock': labels.statusIn,
    'low-stock': labels.statusLow,
    'out-of-stock': labels.statusOut,
    untracked: labels.statusUntracked,
  };

  const columns: DataTableColumn<InventoryTableRow>[] = [
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
      // A SKU is a code, not a word: always one LTR run, in both languages.
      header: labels.colSku,
      cell: (row) => (
        <span dir="ltr" className="inline-block text-(--color-text-muted) tabular-nums">
          {row.sku}
        </span>
      ),
    },
    {
      key: 'stock',
      header: labels.colStock,
      align: 'end',
      cell: (row) =>
        row.trackInventory ? (
          <span className="font-medium tabular-nums">{row.stockQuantity}</span>
        ) : (
          <span className="text-(--color-text-muted)">—</span>
        ),
    },
    {
      key: 'threshold',
      header: labels.colThreshold,
      align: 'end',
      cell: (row) =>
        row.trackInventory ? (
          <span className="text-(--color-text-muted) tabular-nums">{row.lowStockThreshold}</span>
        ) : (
          <span className="text-(--color-text-muted)">—</span>
        ),
    },
    {
      key: 'status',
      header: labels.colStatus,
      cell: (row) => <StatusBadge label={statusLabel[row.status]} tone={STATUS_TONE[row.status]} />,
    },
  ];

  if (canAdjust) {
    columns.push({
      key: 'actions',
      header: labels.actions,
      align: 'end',
      // `relative`: the label below is `sr-only` (absolutely positioned) on
      // small screens. Without a positioned ancestor its containing block is
      // the viewport, so it sits at its static position — far inside the
      // table's horizontal scroll — and widens the *document* rather than
      // the scroll container, giving the whole admin page a horizontal
      // scrollbar on a phone.
      cell: (row) => (
        <div className="relative flex items-center justify-end gap-1">
          <Button size="sm" variant="outline" onClick={() => setAdjusting(row)}>
            <PackagePlus className="size-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">{labels.adjust}</span>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`${labels.policy}: ${row.sku}`}
            onClick={() => setEditingPolicy(row)}
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ),
    });
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

      <AdjustStockDialog
        row={adjusting}
        onClose={() => setAdjusting(null)}
        locale={locale}
        labels={labels}
        onDone={() => router.refresh()}
      />

      <InventoryPolicyDialog
        row={editingPolicy}
        onClose={() => setEditingPolicy(null)}
        locale={locale}
        labels={labels}
        onDone={() => router.refresh()}
      />
    </div>
  );
}

function AdjustStockDialog({
  row,
  onClose,
  locale,
  labels,
  onDone,
}: {
  row: InventoryTableRow | null;
  onClose: () => void;
  locale: Locale;
  labels: InventoryTableLabels;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<'delta' | 'set'>('delta');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<InventoryReason>('RESTOCK');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonLabel: Record<InventoryReason, string> = {
    RESTOCK: labels.reasonRESTOCK,
    RETURN: labels.reasonRETURN,
    DAMAGED: labels.reasonDAMAGED,
    CORRECTION: labels.reasonCORRECTION,
    MANUAL: labels.reasonMANUAL,
  };

  function reset(): void {
    setMode('delta');
    setAmount('');
    setReason('RESTOCK');
    setNote('');
    setError(null);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!row) return;
    const parsed = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(parsed)) return;

    setBusy(true);
    setError(null);
    // The intent goes to the server, never a computed result: the service
    // resolves it against the row it holds a lock on, so a page that went
    // stale while this dialog was open cannot overwrite someone else's count.
    const result = await adjustStockAction(
      row.variantId,
      {
        ...(mode === 'delta' ? { delta: parsed } : { setTo: parsed }),
        reason,
        note,
      },
      locale,
    );
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? null);
      return;
    }
    toast({
      title: labels.adjusted
        .replace('{before}', String(result.data?.previousQuantity ?? ''))
        .replace('{after}', String(result.data?.newQuantity ?? '')),
      variant: 'success',
    });
    reset();
    onClose();
    onDone();
  }

  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.adjustTitle.replace('{sku}', row?.sku ?? '')}</DialogTitle>
          <DialogDescription>
            {labels.adjustCurrent}: <span className="tabular-nums">{row?.stockQuantity ?? 0}</span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          {error ? (
            <Alert variant="error" role="alert">
              {error}
            </Alert>
          ) : null}

          <fieldset className="flex flex-col gap-2">
            <legend className="pb-1 text-sm font-medium text-(--color-text)">{labels.mode}</legend>
            <RadioGroup
              value={mode}
              onValueChange={(value) => setMode(value as 'delta' | 'set')}
              className="flex flex-wrap gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="delta" id="adjust-mode-delta" />
                <Label htmlFor="adjust-mode-delta">{labels.modeDelta}</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="set" id="adjust-mode-set" />
                <Label htmlFor="adjust-mode-set">{labels.modeSet}</Label>
              </div>
            </RadioGroup>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="adjust-amount">
              {mode === 'delta' ? labels.deltaLabel : labels.setToLabel}
            </Label>
            <Input
              id="adjust-amount"
              type="number"
              step="1"
              {...(mode === 'set' ? { min: 0 } : {})}
              dir="ltr"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="tabular-nums"
              aria-describedby="adjust-amount-help"
            />
            <p id="adjust-amount-help" className="text-caption text-(--color-text-muted)">
              {mode === 'delta' ? labels.deltaHelp : labels.setToHelp}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="adjust-reason">{labels.reason}</Label>
            <Select value={reason} onValueChange={(value) => setReason(value as InventoryReason)}>
              <SelectTrigger id="adjust-reason">
                <SelectValue>{reasonLabel[reason]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {reasonLabel[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="adjust-note">{labels.note}</Label>
            <Textarea
              id="adjust-note"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-describedby="adjust-note-help"
            />
            <p id="adjust-note-help" className="text-caption text-(--color-text-muted)">
              {labels.noteHelp}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {labels.cancel}
            </Button>
            <Button type="submit" loading={busy} disabled={busy}>
              {busy ? labels.saving : labels.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InventoryPolicyDialog({
  row,
  onClose,
  locale,
  labels,
  onDone,
}: {
  row: InventoryTableRow | null;
  onClose: () => void;
  locale: Locale;
  labels: InventoryTableLabels;
  onDone: () => void;
}) {
  // State derived from a changing prop: re-seeded on the render where the
  // dialog switches to a different variant, rather than in an effect.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [track, setTrack] = useState(true);
  const [threshold, setThreshold] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (row && seededFor !== row.variantId) {
    setSeededFor(row.variantId);
    setTrack(row.trackInventory);
    setThreshold(String(row.lowStockThreshold));
    setError(null);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!row) return;
    setBusy(true);
    setError(null);
    const result = await setInventoryPolicyAction(
      row.variantId,
      { trackInventory: track, lowStockThreshold: Number(threshold) || 0 },
      row.updatedAt,
      locale,
    );
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? null);
      return;
    }
    toast({ title: labels.policySaved, variant: 'success' });
    onClose();
    onDone();
  }

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.policyTitle.replace('{sku}', row?.sku ?? '')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          {error ? (
            <Alert variant="error" role="alert">
              {error}
            </Alert>
          ) : null}

          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="policy-track">{labels.trackInventory}</Label>
              <p className="text-caption text-(--color-text-muted)">{labels.trackInventoryHelp}</p>
            </div>
            <Switch id="policy-track" checked={track} onCheckedChange={setTrack} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="policy-threshold">{labels.lowStockThreshold}</Label>
            <Input
              id="policy-threshold"
              type="number"
              min={0}
              step="1"
              dir="ltr"
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
              disabled={!track}
              className="w-32 tabular-nums"
              aria-describedby="policy-threshold-help"
            />
            <p id="policy-threshold-help" className="text-caption text-(--color-text-muted)">
              {labels.lowStockThresholdHelp}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {labels.cancel}
            </Button>
            <Button type="submit" loading={busy} disabled={busy}>
              {busy ? labels.saving : labels.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
