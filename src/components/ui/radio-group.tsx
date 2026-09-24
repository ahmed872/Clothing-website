import { RadioGroup as RadixRadioGroup } from 'radix-ui';

import { cn } from '@/lib/utils';

export function RadioGroup({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixRadioGroup.Root>) {
  return <RadixRadioGroup.Root className={cn('flex flex-col gap-2', className)} {...props} />;
}

export function RadioGroupItem({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixRadioGroup.Item>) {
  return (
    <RadixRadioGroup.Item
      className={cn(
        'flex size-4.5 shrink-0 items-center justify-center rounded-(--radius-full) border border-(--color-border-strong) ' +
          'bg-(--color-surface) transition-colors duration-(--duration-fast) outline-none',
        'hover:border-(--color-primary) focus-visible:ring-2 focus-visible:ring-(--color-ring)/25',
        'data-[state=checked]:border-(--color-primary)',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadixRadioGroup.Indicator className="size-2 rounded-(--radius-full) bg-(--color-primary)" />
    </RadixRadioGroup.Item>
  );
}
