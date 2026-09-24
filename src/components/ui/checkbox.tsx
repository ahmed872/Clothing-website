import { Checkbox as RadixCheckbox } from 'radix-ui';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

export function Checkbox({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixCheckbox.Root>) {
  return (
    <RadixCheckbox.Root
      className={cn(
        'peer flex size-4.5 shrink-0 items-center justify-center rounded-(--radius-xs) border border-(--color-border-strong) ' +
          'bg-(--color-surface) transition-colors duration-(--duration-fast) outline-none',
        'hover:border-(--color-primary) focus-visible:ring-2 focus-visible:ring-(--color-ring)/25',
        'data-[state=checked]:border-(--color-primary) data-[state=checked]:bg-(--color-primary)',
        'aria-invalid:border-(--color-error)',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadixCheckbox.Indicator className="text-(--color-primary-foreground)">
        <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}
