import { AlertOctagon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface ErrorStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState({
  title = 'حدث خطأ غير متوقع',
  description,
  onRetry,
  retryLabel = 'إعادة المحاولة',
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-3 rounded-(--radius-surface) border border-(--color-error)/25 ' +
          'bg-(--color-error-surface) px-6 py-16 text-center',
        className,
      )}
      {...props}
    >
      <div className="flex size-12 items-center justify-center rounded-(--radius-full) bg-(--color-surface)">
        <AlertOctagon className="size-5 text-(--color-error)" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-h6 text-(--color-text)">{title}</p>
        {description ? (
          <p className="max-w-sm text-small text-(--color-text-muted)">{description}</p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
