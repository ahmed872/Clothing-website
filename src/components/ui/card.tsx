import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-(--radius-surface) border border-(--color-border) bg-(--color-surface) shadow-(--shadow-xs)',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 p-6', className)} {...props} />;
}

/**
 * The heading level is a prop, not a constant.
 *
 * A card's title is a section heading, and the correct level depends on
 * where the card sits: directly under a page's `h1` it is an `h2`, nested
 * inside an `h2` section it is an `h3`. Hard-coding `h3` made every page
 * whose cards are top-level skip a level, which axe reports as
 * `heading-order` and which a screen-reader user hears as a missing section.
 * The default stays `h3` so existing nested usage is unchanged; pages whose
 * cards are top-level pass `as="h2"`. The visual size comes from
 * `text-h6` either way — level is structure, not appearance.
 */
export function CardTitle({
  className,
  as: Heading = 'h3',
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { as?: 'h2' | 'h3' | 'h4' }) {
  return <Heading className={cn('text-h6 text-(--color-text)', className)} {...props} />;
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-small text-(--color-text-muted)', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-6 pb-6', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 border-t border-(--color-border) px-6 py-4',
        className,
      )}
      {...props}
    />
  );
}
