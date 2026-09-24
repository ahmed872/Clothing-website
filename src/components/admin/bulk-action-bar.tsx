import { X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface BulkActionBarProps {
  selectedCount: number;
  onClear: () => void;
  actions: React.ReactNode;
  className?: string;
  /** Every string here defaults to Arabic (the store default locale) and can be overridden per call site for English. */
  toolbarLabel?: string;
  clearLabel?: string;
  /** Given the current `selectedCount`, e.g. `(n) => `${n} selected`. */
  countLabel?: (count: number) => string;
}

/** Appears once at least one row is selected in a `DataTable`. Fixed to the
 * bottom of the viewport so it never scrolls out of reach on a long table. */
export function BulkActionBar({
  selectedCount,
  onClear,
  actions,
  className,
  toolbarLabel = 'إجراءات جماعية',
  clearLabel = 'إلغاء التحديد',
  countLabel = (count) => `${count} محدد`,
}: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-6 z-40 mx-auto flex w-fit items-center gap-3 rounded-(--radius-lg) ' +
          'border border-(--color-border) bg-(--color-elevated) px-4 py-2.5 shadow-(--shadow-lg)',
        'animate-in slide-in-from-bottom-2 fade-in-0',
        className,
      )}
      role="toolbar"
      aria-label={toolbarLabel}
    >
      <Button variant="ghost" size="icon" onClick={onClear} aria-label={clearLabel}>
        <X aria-hidden="true" />
      </Button>
      <span className="tabular-nums text-sm font-medium text-(--color-text)">
        {countLabel(selectedCount)}
      </span>
      <div className="h-5 w-px bg-(--color-border)" aria-hidden="true" />
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}
