import { Tabs as RadixTabs } from 'radix-ui';

import { cn } from '@/lib/utils';

export const Tabs = RadixTabs.Root;

export function TabsList({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      className={cn(
        'inline-flex h-10 items-center gap-1 rounded-(--radius-control) bg-(--color-muted) p-1',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        'inline-flex h-8 items-center justify-center rounded-(--radius-sm) px-3 text-sm font-medium ' +
          'text-(--color-text-muted) outline-none transition-colors duration-(--duration-fast)',
        'hover:text-(--color-text) focus-visible:ring-2 focus-visible:ring-(--color-ring)/25',
        'data-[state=active]:bg-(--color-surface) data-[state=active]:text-(--color-text) data-[state=active]:shadow-(--shadow-xs)',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixTabs.Content>) {
  return (
    <RadixTabs.Content
      className={cn(
        'mt-4 outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)/25',
        className,
      )}
      {...props}
    />
  );
}
