import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

const alertVariants = cva('flex gap-3 rounded-(--radius-surface) border p-4 text-sm', {
  variants: {
    variant: {
      info: 'border-(--color-info)/25 bg-(--color-info-surface) text-(--color-text)',
      success: 'border-(--color-success)/25 bg-(--color-success-surface) text-(--color-text)',
      warning: 'border-(--color-warning)/30 bg-(--color-warning-surface) text-(--color-text)',
      error: 'border-(--color-error)/25 bg-(--color-error-surface) text-(--color-text)',
    },
  },
  defaultVariants: { variant: 'info' },
});

const ICON_TONE = {
  info: 'text-(--color-info)',
  success: 'text-(--color-success)',
  warning: 'text-(--color-warning)',
  error: 'text-(--color-error)',
} as const;

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
} as const;

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  title?: string;
}

export function Alert({ className, variant = 'info', title, children, ...props }: AlertProps) {
  const Icon = ICONS[variant ?? 'info'];
  return (
    <div role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      <Icon
        className={cn('mt-0.5 size-4.5 shrink-0', ICON_TONE[variant ?? 'info'])}
        aria-hidden="true"
      />
      <div className="flex flex-col gap-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-(--color-text-muted)">{children}</div> : null}
      </div>
    </div>
  );
}
