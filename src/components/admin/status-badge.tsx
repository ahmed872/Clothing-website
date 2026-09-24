import { cn } from '@/lib/utils';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

export interface StatusBadgeProps {
  label: string;
  tone: StatusTone;
  className?: string;
}

const DOT_TONE: Record<StatusTone, string> = {
  neutral: 'bg-(--color-text-subtle)',
  info: 'bg-(--color-info)',
  success: 'bg-(--color-success)',
  warning: 'bg-(--color-warning)',
  error: 'bg-(--color-error)',
};

/**
 * A dot + label, distinct from the commerce `Badge`'s filled pill: admin
 * tables show many statuses in one row, and a run of solid colour chips reads
 * louder than the data itself. Order/payment/inventory status enums are
 * mapped to a tone by the module that owns them, not by this component.
 */
export function StatusBadge({ label, tone, className }: StatusBadgeProps) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm text-(--color-text)', className)}>
      <span
        className={cn('size-2 shrink-0 rounded-(--radius-full)', DOT_TONE[tone])}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
