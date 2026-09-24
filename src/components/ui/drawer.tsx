import { Dialog as RadixDialog } from 'radix-ui';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * A slide-in panel built on the Dialog primitive rather than a separate
 * library — same focus trap, same escape/overlay-close behaviour, same
 * accessibility tree, just a different entrance.
 *
 * `side="start"`/`"end"` use logical direction (the side nearest the reading
 * start/end), so a drawer opens from the correct physical edge in both RTL
 * and LTR without the caller knowing which is which.
 */

export const Drawer = RadixDialog.Root;
export const DrawerTrigger = RadixDialog.Trigger;
export const DrawerClose = RadixDialog.Close;

type Side = 'start' | 'end' | 'top' | 'bottom';

const SIDE_CLASSES: Record<Side, string> = {
  start:
    'inset-y-0 start-0 h-full w-full max-w-sm border-e ' +
    'data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left rtl:data-[state=open]:slide-in-from-right rtl:data-[state=closed]:slide-out-to-right',
  end:
    'inset-y-0 end-0 h-full w-full max-w-sm border-s ' +
    'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right rtl:data-[state=open]:slide-in-from-left rtl:data-[state=closed]:slide-out-to-left',
  top: 'inset-x-0 top-0 w-full border-b data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top',
  bottom:
    'inset-x-0 bottom-0 w-full border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
};

export function DrawerContent({
  className,
  children,
  side = 'end',
  showClose = true,
  closeLabel = 'إغلاق',
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixDialog.Content> & {
  side?: Side;
  showClose?: boolean;
  /** The close button's screen-reader-only label. Defaults to Arabic (the store default locale). */
  closeLabel?: string;
}) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay
        className={cn(
          'fixed inset-0 z-50 bg-(--color-overlay)',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        )}
      />
      <RadixDialog.Content
        className={cn(
          'fixed z-50 flex flex-col gap-4 bg-(--color-elevated) p-6 shadow-(--shadow-overlay) outline-none',
          'border-(--color-border) data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-(--duration-fast)',
          SIDE_CLASSES[side],
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

export function DrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 text-start', className)} {...props} />;
}

export function DrawerFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-auto flex flex-col gap-2', className)} {...props} />;
}

export function DrawerTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixDialog.Title>) {
  return <RadixDialog.Title className={cn('text-h5 text-(--color-text)', className)} {...props} />;
}

export function DrawerDescription({
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
