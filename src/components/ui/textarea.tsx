import { cn } from '@/lib/utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(
        'flex w-full rounded-(--radius-control) border border-(--color-border) bg-(--color-surface) ' +
          'px-3 py-2 text-sm text-(--color-text) transition-colors duration-(--duration-fast) ' +
          'placeholder:text-(--color-text-subtle) outline-none',
        'focus-visible:border-(--color-ring) focus-visible:ring-2 focus-visible:ring-(--color-ring)/25',
        'aria-invalid:border-(--color-error) aria-invalid:focus-visible:ring-(--color-error)/25',
        'disabled:cursor-not-allowed disabled:bg-(--color-disabled) disabled:text-(--color-disabled-foreground)',
        className,
      )}
      {...props}
    />
  );
}
