import { DropdownMenu as RadixDropdownMenu } from 'radix-ui';
import { Check, ChevronRight, Circle } from 'lucide-react';

import { cn } from '@/lib/utils';

export const DropdownMenu = RadixDropdownMenu.Root;
export const DropdownMenuTrigger = RadixDropdownMenu.Trigger;
export const DropdownMenuGroup = RadixDropdownMenu.Group;
export const DropdownMenuSub = RadixDropdownMenu.Sub;
export const DropdownMenuRadioGroup = RadixDropdownMenu.RadioGroup;

const contentClasses =
  'z-50 min-w-40 overflow-hidden rounded-(--radius-control) border border-(--color-border) ' +
  'bg-(--color-elevated) p-1 text-(--color-text) shadow-(--shadow-lg) ' +
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 ' +
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95';

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixDropdownMenu.Content>) {
  return (
    <RadixDropdownMenu.Portal>
      <RadixDropdownMenu.Content
        sideOffset={sideOffset}
        className={cn(contentClasses, className)}
        {...props}
      />
    </RadixDropdownMenu.Portal>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixDropdownMenu.SubContent>) {
  return (
    <RadixDropdownMenu.Portal>
      <RadixDropdownMenu.SubContent className={cn(contentClasses, className)} {...props} />
    </RadixDropdownMenu.Portal>
  );
}

const itemClasses =
  'relative flex cursor-pointer items-center gap-2 rounded-(--radius-sm) px-2 py-1.5 text-sm outline-none select-none ' +
  'data-[highlighted]:bg-(--color-surface-raised) data-[disabled]:pointer-events-none data-[disabled]:opacity-50';

export function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixDropdownMenu.Item> & {
  inset?: boolean;
  variant?: 'default' | 'destructive';
}) {
  return (
    <RadixDropdownMenu.Item
      className={cn(
        itemClasses,
        inset && 'ps-8',
        variant === 'destructive' &&
          'text-(--color-error) data-[highlighted]:bg-(--color-error-surface)',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixDropdownMenu.CheckboxItem>) {
  return (
    <RadixDropdownMenu.CheckboxItem className={cn(itemClasses, 'ps-8', className)} {...props}>
      <span className="absolute start-2 inline-flex size-4 items-center justify-center">
        <RadixDropdownMenu.ItemIndicator>
          <Check className="size-3.5" aria-hidden="true" />
        </RadixDropdownMenu.ItemIndicator>
      </span>
      {children}
    </RadixDropdownMenu.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixDropdownMenu.RadioItem>) {
  return (
    <RadixDropdownMenu.RadioItem className={cn(itemClasses, 'ps-8', className)} {...props}>
      <span className="absolute start-2 inline-flex size-4 items-center justify-center">
        <RadixDropdownMenu.ItemIndicator>
          <Circle className="size-2 fill-current" aria-hidden="true" />
        </RadixDropdownMenu.ItemIndicator>
      </span>
      {children}
    </RadixDropdownMenu.RadioItem>
  );
}

export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixDropdownMenu.Label> & { inset?: boolean }) {
  return (
    <RadixDropdownMenu.Label
      className={cn(
        'px-2 py-1.5 text-xs font-medium text-(--color-text-muted)',
        inset && 'ps-8',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixDropdownMenu.Separator>) {
  return (
    <RadixDropdownMenu.Separator
      className={cn('my-1 h-px bg-(--color-border)', className)}
      {...props}
    />
  );
}

export function DropdownMenuShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('ms-auto text-xs tracking-wide text-(--color-text-muted)', className)}
      {...props}
    />
  );
}

export function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixDropdownMenu.SubTrigger> & { inset?: boolean }) {
  return (
    <RadixDropdownMenu.SubTrigger
      className={cn(itemClasses, inset && 'ps-8', className)}
      {...props}
    >
      {children}
      <ChevronRight className="ms-auto size-4 rtl:rotate-180" aria-hidden="true" />
    </RadixDropdownMenu.SubTrigger>
  );
}
