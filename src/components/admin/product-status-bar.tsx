'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Eye, Send, Archive, Undo2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { toast } from '@/components/ui/toast';
import { StatusBadge, type StatusTone } from '@/components/admin/status-badge';
import { ConfirmationDialog } from '@/components/admin/confirmation-dialog';
import {
  publishProductAction,
  archiveProductAction,
  updateProductAction,
  deleteProductAction,
} from '@/lib/admin/product-actions';
import type { Locale } from '@/lib/i18n/locales';

export type ProductStatusValue = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface ProductStatusBarLabels {
  current: string;
  statusDraft: string;
  statusPublished: string;
  statusArchived: string;
  publish: string;
  publishing: string;
  published: string;
  backToDraft: string;
  backToDraftDone: string;
  archive: string;
  archived: string;
  archiveConfirm: string;
  delete: string;
  deleted: string;
  deleteConfirm: string;
  preview: string;
  confirmDeleteTitle: string;
  cancel: string;
  confirm: string;
}

const TONE: Record<ProductStatusValue, StatusTone> = {
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  ARCHIVED: 'warning',
};

/**
 * Draft / Published / Archived, and the one place a product moves between
 * them. Publishing is a distinct server action, not a status field on the
 * form: the server re-runs its own publishability check (P07 §24 — the
 * server decides, and a product never lands PUBLISHED with a missing
 * variant or name), and what comes back is shown here, listing each
 * missing piece.
 *
 * Deleting is `products.delete` and is a soft delete — order history,
 * reviews and analytics all still point at the row.
 */
export function ProductStatusBar({
  productId,
  status,
  locale,
  labels,
  canDelete,
}: {
  productId: string;
  status: ProductStatusValue;
  locale: Locale;
  labels: ProductStatusBarLabels;
  /** The server is still the authority — this only hides a button the
   * caller's role could never use anyway (P07 §21: never rely on a hidden
   * button, but do not show one that always fails either). */
  canDelete: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<'archive' | 'delete' | null>(null);

  const statusLabel: Record<ProductStatusValue, string> = {
    DRAFT: labels.statusDraft,
    PUBLISHED: labels.statusPublished,
    ARCHIVED: labels.statusArchived,
  };

  async function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    successText: string,
    after?: () => void,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? null);
      return;
    }
    toast({ title: successText, variant: 'success' });
    after?.();
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <Alert variant="error" role="alert">
          {error}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-small text-(--color-text-muted)">{labels.current}</span>
        <StatusBadge label={statusLabel[status]} tone={TONE[status]} />

        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href={`/admin/products/${productId}/preview`}>
              <Eye className="size-4" aria-hidden="true" />
              {labels.preview}
            </Link>
          </Button>

          {status === 'PUBLISHED' ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(
                  () => updateProductAction(productId, { status: 'DRAFT' }, null, locale),
                  labels.backToDraftDone,
                )
              }
            >
              <Undo2 className="size-4" aria-hidden="true" />
              {labels.backToDraft}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() => publishProductAction(productId, locale), labels.published)
              }
            >
              <Send className="size-4" aria-hidden="true" />
              {busy ? labels.publishing : labels.publish}
            </Button>
          )}

          {status === 'ARCHIVED' ? null : (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirming('archive')}
            >
              <Archive className="size-4" aria-hidden="true" />
              {labels.archive}
            </Button>
          )}

          {canDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label={labels.delete}
              onClick={() => setConfirming('delete')}
            >
              <Trash2 className="size-4 text-(--color-error)" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>

      <ConfirmationDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={confirming === 'delete' ? labels.delete : labels.archive}
        description={
          error ?? (confirming === 'delete' ? labels.deleteConfirm : labels.archiveConfirm)
        }
        confirmLabel={labels.confirm}
        cancelLabel={labels.cancel}
        destructive
        loading={busy}
        onConfirm={() => {
          if (confirming === 'delete') {
            void run(
              () => deleteProductAction(productId, locale),
              labels.deleted,
              () => {
                setConfirming(null);
                router.push('/admin/products');
              },
            );
            return;
          }
          void run(
            () => archiveProductAction(productId, locale),
            labels.archived,
            () => setConfirming(null),
          );
        }}
      />
    </div>
  );
}
