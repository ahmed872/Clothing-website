import { Select as RadixSelect } from 'radix-ui';
import { Check, ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';

import { cn } from '@/lib/utils';

export const Select = RadixSelect.Root;
export const SelectGroup = RadixSelect.Group;

/**
 * Radix's `placeholder` only ever shows for an *empty* value — a `Select`
 * with `defaultValue` set skips it, and instead waits for the matching
 * `SelectItem` to mount (which only happens once `SelectContent` has opened)
 * before it has any text to show. Until then it renders empty: no visible
 * text, no accessible name. Pass literal `children` matching the current
 * value so there is something from the very first paint — Radix portals the
 * real item's text into this node the moment a selection is made, silently
 * replacing it, so the fallback never goes stale after that first render.
 */
export const SelectValue = RadixSelect.Value;

/**
 * `role="combobox"` is a widget role, not a content role: its accessible
 * name is never computed from visible text inside it (unlike a `<button>`),
 * only from `aria-label`, `aria-labelledby`, or an associated `<label>`. A
 * trigger with visible selected-value text but neither of those still reads
 * as unlabelled to assistive tech — pair every `SelectTrigger` with a
 * `<Label htmlFor>` pointing at its `id`, or pass `aria-label` directly when
 * there is no visible label in the layout (a compact filter, say).
 */
export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixSelect.Trigger>) {
  return (
    <RadixSelect.Trigger
      className={cn(
        'flex h-10 w-full items-center justify-between gap-2 rounded-(--radius-control) border ' +
          'border-(--color-border) bg-(--color-surface) px-3 text-sm text-(--color-text) outline-none',
        'transition-colors duration-(--duration-fast) data-[placeholder]:text-(--color-text-muted)',
        'hover:bg-(--color-surface-raised) focus-visible:border-(--color-ring) focus-visible:ring-2 focus-visible:ring-(--color-ring)/25',
        'aria-invalid:border-(--color-error)',
        'disabled:cursor-not-allowed disabled:bg-(--color-disabled) disabled:text-(--color-disabled-foreground)',
        className,
      )}
      {...props}
    >
      {children}
      <RadixSelect.Icon>
        <ChevronsUpDown className="size-4 text-(--color-text-muted)" aria-hidden="true" />
      </RadixSelect.Icon>
    </RadixSelect.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixSelect.Content>) {
  return (
    <RadixSelect.Portal>
      <RadixSelect.Content
        position={position}
        sideOffset={4}
        className={cn(
          'z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden ' +
            'rounded-(--radius-control) border border-(--color-border) bg-(--color-elevated) text-(--color-text) shadow-(--shadow-lg)',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      >
        <RadixSelect.ScrollUpButton className="flex items-center justify-center py-1">
          <ChevronUp className="size-4" aria-hidden="true" />
        </RadixSelect.ScrollUpButton>
        <RadixSelect.Viewport className="p-1">{children}</RadixSelect.Viewport>
        <RadixSelect.ScrollDownButton className="flex items-center justify-center py-1">
          <ChevronDown className="size-4" aria-hidden="true" />
        </RadixSelect.ScrollDownButton>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixSelect.Item>) {
  return (
    <RadixSelect.Item
      className={cn(
        'relative flex cursor-pointer items-center rounded-(--radius-sm) py-2 ps-8 pe-3 text-sm outline-none select-none',
        'data-[highlighted]:bg-(--color-surface-raised)',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute start-2.5 inline-flex size-4 items-center justify-center">
        <RadixSelect.ItemIndicator>
          <Check className="size-4 text-(--color-primary)" aria-hidden="true" />
        </RadixSelect.ItemIndicator>
      </span>
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    </RadixSelect.Item>
  );
}
