import { cn } from '@/lib/utils';

export interface FormSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Groups related fields inside a long admin form (product edit, settings, …)
 * with a title and helper text in a fixed-width side column — the pattern
 * used once a form has more than about six fields, so the page doesn't read
 * as one undifferentiated column.
 */
export function FormSection({ title, description, children, className }: FormSectionProps) {
  return (
    <section className={cn('grid grid-cols-1 gap-6 py-6 first:pt-0 lg:grid-cols-3', className)}>
      <div className="flex flex-col gap-1 lg:col-span-1">
        <h2 className="text-h6 text-(--color-text)">{title}</h2>
        {description ? <p className="text-small text-(--color-text-muted)">{description}</p> : null}
      </div>
      <div className="flex flex-col gap-4 lg:col-span-2">{children}</div>
    </section>
  );
}
