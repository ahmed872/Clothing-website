import { cn } from '@/lib/utils';

/** A loading placeholder. Respects `prefers-reduced-motion` globally (see globals.css). */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="presentation"
      aria-hidden="true"
      className={cn('animate-pulse rounded-(--radius-sm) bg-(--color-muted)', className)}
      {...props}
    />
  );
}
