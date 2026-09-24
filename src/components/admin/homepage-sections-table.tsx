'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Trash2, Upload, Undo2 } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { StatusBadge, type StatusTone } from '@/components/admin/status-badge';
import { ConfirmationDialog } from '@/components/admin/confirmation-dialog';
import {
  deleteHomepageSectionAction,
  discardHomepageSectionDraftAction,
  publishHomepageSectionDraftAction,
  reorderHomepageSectionsAction,
  setHomepageSectionEnabledAction,
} from '@/lib/admin/content-actions';
import type { Locale } from '@/lib/i18n/locales';

/**
 * The homepage, as a list you can rearrange (P15).
 *
 * Rendered as a list of cards rather than a `DataTable`: every row carries
 * six actions and a two-line title in two languages, which is more than a
 * table cell holds legibly at 390px, and the *order* is the data here — a
 * numbered, reorderable list says that where a sortable table would imply
 * the opposite.
 *
 * Reordering is up/down buttons, not drag-and-drop. Drag is unusable by
 * keyboard and by screen reader, and this list is short by nature; each
 * press sends the whole resulting order to the server, which rejects
 * anything that isn't a complete permutation, so a failed request leaves
 * the stored order exactly as it was.
 *
 * Nothing here is authorization. The page only renders for a caller that
 * passed `requireAdminPermission('content.manage')`, and every action
 * re-runs `requirePermission` server-side — hiding a button is a courtesy,
 * not a control (P06 §7/§17).
 */

export interface SectionRow {
  id: string;
  type: string;
  typeLabel: string;
  titleAr: string | null;
  titleEn: string | null;
  enabled: boolean;
  hasDraft: boolean;
}

export interface SectionsTableLabels {
  colSection: string;
  colType: string;
  colState: string;
  untitled: string;
  stateLive: string;
  stateHidden: string;
  stateDraft: string;
  moveUp: string;
  moveDown: string;
  orderSaved: string;
  show: string;
  hide: string;
  shown: string;
  hidden: string;
  edit: string;
  publishDraft: string;
  discardDraft: string;
  draftPublished: string;
  draftDiscarded: string;
  delete: string;
  deleted: string;
  confirmDeleteTitle: string;
  confirmDeleteDescription: string;
  confirmDiscardTitle: string;
  confirmDiscardDescription: string;
  confirm: string;
  cancel: string;
}

function displayTitle(row: SectionRow, locale: Locale, untitled: string): string {
  const preferred = locale === 'ar' ? row.titleAr : row.titleEn;
  return preferred ?? row.titleAr ?? row.titleEn ?? untitled;
}

export function HomepageSectionsTable({
  rows,
  locale,
  labels,
}: {
  rows: SectionRow[];
  locale: Locale;
  labels: SectionsTableLabels;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SectionRow | null>(null);
  const [discardTarget, setDiscardTarget] = useState<SectionRow | null>(null);

  async function run(
    id: string,
    action: () => Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
  ): Promise<void> {
    setBusyId(id);
    setError(null);
    const result = await action();
    setBusyId(null);

    if (!result.ok) {
      setError(result.error ?? null);
      return;
    }
    toast({ title: successMessage, variant: 'success' });
    router.refresh();
  }

  async function move(index: number, delta: number): Promise<void> {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const order = rows.map((row) => row.id);
    const [moved] = order.splice(index, 1);
    order.splice(target, 0, moved!);

    await run(
      rows[index]!.id,
      () => reorderHomepageSectionsAction(order, locale),
      labels.orderSaved,
    );
  }

  function stateBadge(row: SectionRow): { label: string; tone: StatusTone } {
    if (!row.enabled) return { label: labels.stateHidden, tone: 'neutral' };
    if (row.hasDraft) return { label: labels.stateDraft, tone: 'warning' };
    return { label: labels.stateLive, tone: 'success' };
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="error" role="alert">
          {error}
        </Alert>
      ) : null}

      <ol className="flex flex-col gap-3">
        {rows.map((row, index) => {
          const title = displayTitle(row, locale, labels.untitled);
          const badge = stateBadge(row);
          const busy = busyId === row.id;

          return (
            <li
              key={row.id}
              className="flex flex-col gap-3 rounded-(--radius-container) border border-(--color-border) bg-(--color-surface) p-4 sm:flex-row sm:items-center"
            >
              <div className="flex items-center gap-2 sm:flex-col sm:gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${labels.moveUp} — ${title}`}
                  disabled={index === 0 || busy}
                  onClick={() => void move(index, -1)}
                >
                  <ArrowUp className="size-4" aria-hidden="true" />
                </Button>
                <span
                  className="w-6 text-center text-caption tabular-nums text-(--color-text-subtle)"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${labels.moveDown} — ${title}`}
                  disabled={index === rows.length - 1 || busy}
                  onClick={() => void move(index, 1)}
                >
                  <ArrowDown className="size-4" aria-hidden="true" />
                </Button>
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="truncate text-body font-medium text-(--color-text)">{title}</p>
                <p className="text-caption text-(--color-text-muted)">{row.typeLabel}</p>
                <StatusBadge label={badge.label} tone={badge.tone} className="text-caption" />
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {row.hasDraft ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          row.id,
                          () => publishHomepageSectionDraftAction(row.id, locale),
                          labels.draftPublished,
                        )
                      }
                    >
                      <Upload className="size-4" aria-hidden="true" />
                      {labels.publishDraft}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`${labels.discardDraft} — ${title}`}
                      disabled={busy}
                      onClick={() => setDiscardTarget(row)}
                    >
                      <Undo2 className="size-4" aria-hidden="true" />
                    </Button>
                  </>
                ) : null}

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${row.enabled ? labels.hide : labels.show} — ${title}`}
                  disabled={busy}
                  onClick={() =>
                    void run(
                      row.id,
                      () => setHomepageSectionEnabledAction(row.id, !row.enabled, locale),
                      row.enabled ? labels.hidden : labels.shown,
                    )
                  }
                >
                  {row.enabled ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                </Button>

                <Button asChild variant="ghost" size="icon">
                  <Link href={`/admin/content/${row.id}`} aria-label={`${labels.edit} — ${title}`}>
                    <Pencil className="size-4" aria-hidden="true" />
                  </Link>
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${labels.delete} — ${title}`}
                  disabled={busy}
                  onClick={() => setDeleteTarget(row)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>

      <ConfirmationDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={labels.confirmDeleteTitle}
        description={labels.confirmDeleteDescription}
        confirmLabel={labels.delete}
        cancelLabel={labels.cancel}
        destructive
        loading={deleteTarget !== null && busyId === deleteTarget.id}
        onConfirm={() => {
          const target = deleteTarget;
          if (!target) return;
          setDeleteTarget(null);
          void run(target.id, () => deleteHomepageSectionAction(target.id, locale), labels.deleted);
        }}
      />

      <ConfirmationDialog
        open={discardTarget !== null}
        onOpenChange={(open) => !open && setDiscardTarget(null)}
        title={labels.confirmDiscardTitle}
        description={labels.confirmDiscardDescription}
        confirmLabel={labels.confirm}
        cancelLabel={labels.cancel}
        destructive
        loading={discardTarget !== null && busyId === discardTarget.id}
        onConfirm={() => {
          const target = discardTarget;
          if (!target) return;
          setDiscardTarget(null);
          void run(
            target.id,
            () => discardHomepageSectionDraftAction(target.id, locale),
            labels.draftDiscarded,
          );
        }}
      />
    </div>
  );
}
