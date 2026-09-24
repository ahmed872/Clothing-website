import { Switch as RadixSwitch } from 'radix-ui';

import { cn } from '@/lib/utils';

export function Switch({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixSwitch.Root>) {
  return (
    <RadixSwitch.Root
      className={cn(
        'peer relative inline-flex h-6 w-10 shrink-0 items-center rounded-(--radius-full) ' +
          'bg-(--color-border-strong) transition-colors duration-(--duration-fast) outline-none',
        'focus-visible:ring-2 focus-visible:ring-(--color-ring)/25 focus-visible:ring-offset-2 focus-visible:ring-offset-(--color-background)',
        'data-[state=checked]:bg-(--color-primary)',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadixSwitch.Thumb
        className={cn(
          'block size-4.5 translate-x-0.5 rounded-(--radius-full) bg-(--color-surface) shadow-(--shadow-xs) ' +
            'transition-transform duration-(--duration-fast)',
          'rtl:-translate-x-0.5 data-[state=checked]:translate-x-[1.125rem] data-[state=checked]:rtl:-translate-x-[1.125rem]',
        )}
      />
    </RadixSwitch.Root>
  );
}
