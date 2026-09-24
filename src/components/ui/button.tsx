import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The first component of the design system.
 *
 * Every colour, radius and spacing value comes from a token — there is not a
 * single hardcoded hex value, and the ESLint rule in `eslint.config.mjs`
 * makes that a build error rather than a convention.
 */

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-(--radius-control) text-sm ' +
    'font-medium transition-colors duration-(--duration-fast) ease-(--ease-standard) outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-(--color-ring) focus-visible:ring-offset-2 ' +
    'focus-visible:ring-offset-(--color-background) disabled:pointer-events-none disabled:opacity-50 ' +
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-(--color-primary) text-(--color-primary-foreground) hover:bg-(--color-primary-hover) active:bg-(--color-primary-active)',
        secondary:
          'bg-(--color-secondary) text-(--color-secondary-foreground) hover:bg-(--color-secondary-hover) active:bg-(--color-secondary-active)',
        outline:
          'border border-(--color-border) bg-(--color-surface) text-(--color-text) hover:bg-(--color-surface-raised) active:bg-(--color-muted)',
        ghost: 'text-(--color-text) hover:bg-(--color-surface-raised) active:bg-(--color-muted)',
        destructive:
          'bg-(--color-error) text-(--color-error-foreground) hover:bg-(--color-error-hover)',
        link: 'text-(--color-primary) underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-sm [&_svg]:size-4',
        md: 'h-10 px-4 [&_svg]:size-4',
        lg: 'h-12 px-6 text-base [&_svg]:size-5',
        icon: 'size-10 [&_svg]:size-4',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Shows a spinner in place of the leading icon and disables the button. */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : 'button';
  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {/* `Slot.Root` (asChild) requires exactly one element child — it merges
          this component's props onto that one child rather than rendering
          its own DOM node, so the loading-icon sibling only makes sense for
          a real `<button>`. `asChild` + `loading` together isn't a
          meaningful combination anyway: asChild hands rendering off
          entirely to the child element. */}
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {children}
        </>
      )}
    </Component>
  );
}

export { buttonVariants };
