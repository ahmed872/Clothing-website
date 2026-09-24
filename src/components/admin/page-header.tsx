import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumb?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  /**
   * Every real admin page uses exactly one `PageHeader` as its top-level
   * heading, so `h1` is the default. Lets a page composing several of these,
   * or showing one nested inside other content, keep the outline correct
   * instead of skipping or repeating a level.
   */
  headingLevel?: 1 | 2 | 3;
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
  className,
  headingLevel = 1,
}: PageHeaderProps) {
  const Heading = `h${headingLevel}` as const;

  return (
    <div className={cn('flex flex-col gap-3 border-b border-(--color-border) pb-5', className)}>
      {breadcrumb}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Heading className="text-h3 text-(--color-text)">{title}</Heading>
          {description ? (
            <p className="text-small text-(--color-text-muted)">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
