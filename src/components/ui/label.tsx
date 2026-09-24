import { Label as RadixLabel } from 'radix-ui';

import { cn } from '@/lib/utils';

export function Label({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixLabel.Root>) {
  return (
    <RadixLabel.Root
      className={cn(
        'text-label text-(--color-text) select-none',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
