import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-(--radius-full) px-2.5 py-0.5 text-xs font-medium ' +
    'ring-1 ring-inset',
  {
    variants: {
      variant: {
        neutral: 'bg-(--color-muted) text-(--color-text-muted) ring-(--color-border)',
        brand: 'bg-(--color-primary) text-(--color-primary-foreground) ring-transparent',
        success: 'bg-(--color-success-surface) text-(--color-success) ring-(--color-success)/20',
        warning: 'bg-(--color-warning-surface) text-(--color-warning) ring-(--color-warning)/25',
        error: 'bg-(--color-error-surface) text-(--color-error) ring-(--color-error)/20',
        info: 'bg-(--color-info-surface) text-(--color-info) ring-(--color-info)/20',
        outline: 'bg-transparent text-(--color-text) ring-(--color-border)',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
