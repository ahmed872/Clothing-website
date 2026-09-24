import { X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface ActiveFilter {
  key: string;
  label: string;
}

export interface FilterBarProps {
  /** Filter controls (selects, date pickers, …) — this component only lays them out. */
  children: React.ReactNode;
  activeFilters?: ActiveFilter[];
  onRemoveFilter?: (key: string) => void;
  onClearAll?: () => void;
  className?: string;
  /** Defaults to Arabic (the store default locale); override per call site for English. */
  clearAllLabel?: string;
  /** Given a filter's label, e.g. `(label) => `Remove ${label}``. */
  removeFilterLabel?: (label: string) => string;
}

export function FilterBar({
  children,
  activeFilters = [],
  onRemoveFilter,
  onClearAll,
  className,
  clearAllLabel = 'مسح الكل',
  removeFilterLabel = (label) => `إزالة ${label}`,
}: FilterBarProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-2">{children}</div>

      {activeFilters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {activeFilters.map((filter) => (
            <span
              key={filter.key}
              className="inline-flex items-center gap-1.5 rounded-(--radius-full) bg-(--color-secondary) py-1 ps-3 pe-1.5 text-xs font-medium text-(--color-secondary-foreground)"
            >
              {filter.label}
              {onRemoveFilter ? (
                <button
                  type="button"
                  onClick={() => onRemoveFilter(filter.key)}
                  aria-label={removeFilterLabel(filter.label)}
                  className="flex size-4 items-center justify-center rounded-(--radius-full) hover:bg-(--color-secondary-hover)"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              ) : null}
            </span>
          ))}
          {onClearAll ? (
            <Button variant="ghost" size="sm" onClick={onClearAll}>
              {clearAllLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
