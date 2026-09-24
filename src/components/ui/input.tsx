import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * `invalid` is read from `aria-invalid` rather than a separate prop: the
 * accessible attribute and the visual state must always agree, so there is
 * only one thing to set.
 */
export function Input({ className, type = 'text', ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-10 w-full min-w-0 rounded-(--radius-control) border border-(--color-border) bg-(--color-surface) ' +
          'px-3 text-sm text-(--color-text) transition-colors duration-(--duration-fast) ' +
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
