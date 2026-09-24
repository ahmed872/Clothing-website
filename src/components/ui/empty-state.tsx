import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-(--radius-surface) border border-dashed border-(--color-border) ' +
          'px-6 py-16 text-center',
        className,
      )}
      {...props}
    >
      <div className="flex size-12 items-center justify-center rounded-(--radius-full) bg-(--color-muted)">
        <Icon className="size-5 text-(--color-text-muted)" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-h6 text-(--color-text)">{title}</p>
        {description ? (
          <p className="max-w-sm text-small text-(--color-text-muted)">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
