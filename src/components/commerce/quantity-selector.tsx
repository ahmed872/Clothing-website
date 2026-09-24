'use client';

import { Minus, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface QuantitySelectorProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  className?: string;
  disabled?: boolean;
  /** Defaults to Arabic (the store default locale); override per call site for English. */
  decreaseLabel?: string;
  increaseLabel?: string;
}

/** A stepper, not a free-text field: quantity is always a valid integer in
 * range, so there is no invalid intermediate state to validate against. */
export function QuantitySelector({
  value,
  onChange,
  min = 1,
  max = 99,
  className,
  disabled,
  decreaseLabel = 'إنقاص الكمية',
  increaseLabel = 'زيادة الكمية',
}: QuantitySelectorProps) {
  const decrease = () => onChange(Math.max(min, value - 1));
  const increase = () => onChange(Math.min(max, value + 1));

  return (
    <div
      className={cn(
        'inline-flex h-10 items-center rounded-(--radius-control) border border-(--color-border)',
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-full rounded-e-none"
        onClick={decrease}
        disabled={disabled || value <= min}
        aria-label={decreaseLabel}
      >
        <Minus aria-hidden="true" />
      </Button>
      <span
        className="tabular-nums flex w-10 items-center justify-center text-sm font-medium text-(--color-text)"
        aria-live="polite"
      >
        {value}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-full rounded-s-none"
        onClick={increase}
        disabled={disabled || value >= max}
        aria-label={increaseLabel}
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  );
}
