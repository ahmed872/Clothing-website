'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { ConfirmationDialog } from '@/components/admin/confirmation-dialog';
import { deleteCategoryAction } from '@/lib/admin/category-actions';
import type { Locale } from '@/lib/i18n/locales';

export interface CategoryRowActionsLabels {
  edit: string;
  delete: string;
  confirmDeleteTitle: string;
  deleteConfirmDescription: string;
  cancel: string;
  confirm: string;
  deletedSuccessfully: string;
}

export function CategoryRowActions({
  categoryId,
  locale,
  labels,
}: {
  categoryId: string;
  locale: Locale;
  labels: CategoryRowActionsLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setDeleting(true);
    setError(null);
    const result = await deleteCategoryAction(categoryId, locale);
    setDeleting(false);
    if (!result.ok) {
      setError(result.error ?? null);
      return;
    }
    setOpen(false);
    toast({ title: labels.deletedSuccessfully, variant: 'success' });
    router.refresh();
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={labels.edit}
        onClick={() => router.push(`/admin/categories/${categoryId}`)}
      >
        <Pencil className="size-4" aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="icon" aria-label={labels.delete} onClick={() => setOpen(true)}>
        <Trash2 className="size-4 text-(--color-error)" aria-hidden="true" />
      </Button>
      <ConfirmationDialog
        open={open}
        onOpenChange={setOpen}
        title={labels.confirmDeleteTitle}
        description={error ?? labels.deleteConfirmDescription}
        confirmLabel={labels.confirm}
        cancelLabel={labels.cancel}
        onConfirm={handleConfirm}
        destructive
        loading={deleting}
      />
    </div>
  );
}
