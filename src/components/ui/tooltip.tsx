import { Tooltip as RadixTooltip } from 'radix-ui';

import { cn } from '@/lib/utils';

export const TooltipProvider = RadixTooltip.Provider;
export const Tooltip = RadixTooltip.Root;
export const TooltipTrigger = RadixTooltip.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixTooltip.Content>) {
  return (
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-(--radius-sm) bg-(--color-elevated) px-2.5 py-1.5 text-xs text-(--color-text) shadow-(--shadow-md) ' +
            'border border-(--color-border)',
          'data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          className,
        )}
        {...props}
      >
        {children}
        <RadixTooltip.Arrow className="fill-(--color-elevated)" />
      </RadixTooltip.Content>
    </RadixTooltip.Portal>
  );
}
