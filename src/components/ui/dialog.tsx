import { Dialog as RadixDialog } from 'radix-ui';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export function DialogOverlay({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixDialog.Overlay>) {
  return (
    <RadixDialog.Overlay
      className={cn(
        'fixed inset-0 z-50 bg-(--color-overlay)',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        className,
      )}
      {...props}
    />
  );
}

export function DialogContent({
  className,
  children,
  showClose = true,
  closeLabel = 'إغلاق',
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixDialog.Content> & {
  showClose?: boolean;
  /** The close button's screen-reader-only label. Defaults to Arabic (the store default locale). */
  closeLabel?: string;
}) {
  return (
    <RadixDialog.Portal>
      <DialogOverlay />
      <RadixDialog.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 ' +
            'rounded-(--radius-lg) border border-(--color-border) bg-(--color-elevated) p-6 shadow-(--shadow-overlay) ' +
            'outline-none',
          // A dialog taller than the viewport (a long form on a phone, or
          // any form on a short laptop window) must scroll inside itself —
          // without this its footer, the Save button included, sits off
          // screen with no way to reach it.
          'max-h-[calc(100dvh-2rem)] overflow-y-auto',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <RadixDialog.Close
            className={cn(
              'absolute top-4 end-4 flex size-7 items-center justify-center rounded-(--radius-sm) text-(--color-text-muted) ' +
                'outline-none transition-colors duration-(--duration-fast) hover:bg-(--color-surface-raised) hover:text-(--color-text)',
              'focus-visible:ring-2 focus-visible:ring-(--color-ring)/25',
            )}
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">{closeLabel}</span>
          </RadixDialog.Close>
        ) : null}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 text-start', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixDialog.Title>) {
  return <RadixDialog.Title className={cn('text-h5 text-(--color-text)', className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixDialog.Description>) {
  return (
    <RadixDialog.Description
      className={cn('text-small text-(--color-text-muted)', className)}
      {...props}
    />
  );
}
