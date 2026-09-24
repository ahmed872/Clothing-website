'use client';

import { RadioGroup as RadixRadioGroup } from 'radix-ui';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface ChoiceOption {
  value: string;
  label: string;
  /** A CSS colour (a design token) shown beside the label — never instead
   * of it: every choice is readable without seeing colour. */
  swatch?: string;
}

/**
 * One closed choice (gender, skin tone, hair…), as a row of labelled chips.
 *
 * Radix's radio group underneath, so it is a real `radiogroup` of `radio`s:
 * one tab stop, arrow keys to move (mirrored in RTL through `dir`), and the
 * checked state announced. Selection shows three ways — border, background
 * and a check mark — so it never depends on colour alone. The value leaves
 * the form through the form's own hidden input, not a Radix bubble input,
 * so "not chosen" can be an empty string.
 */
export function ChoiceGroup({
  id,
  label,
  help,
  required = false,
  requiredMark,
  value,
  onChange,
  options,
  error,
  direction,
  layout = 'wrap',
}: {
  id: string;
  label: string;
  help?: string;
  required?: boolean;
  requiredMark?: string;
  value: string | undefined;
  onChange: (value: string) => void;
  options: readonly ChoiceOption[];
  error?: string;
  direction: 'rtl' | 'ltr';
  layout?: 'wrap' | 'grid';
}) {
  const labelId = `${id}-label`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span id={labelId} className="text-sm font-medium text-(--color-text)">
          {label}
        </span>
        {required && requiredMark ? (
          <span className="text-caption text-(--color-text-subtle)">{requiredMark}</span>
        ) : null}
      </div>
      {help ? (
        <p id={helpId} className="text-caption text-(--color-text-muted)">
          {help}
        </p>
      ) : null}
      <RadixRadioGroup.Root
        id={id}
        value={value ?? ''}
        onValueChange={onChange}
        aria-labelledby={labelId}
        aria-describedby={describedBy || undefined}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        dir={direction}
        loop
        className={cn(
          layout === 'grid' ? 'grid grid-cols-2 gap-2 sm:grid-cols-4' : 'flex flex-wrap gap-2',
        )}
      >
        {options.map((option) => (
          <RadixRadioGroup.Item
            key={option.value}
            value={option.value}
            className={cn(
              'group inline-flex min-h-10 items-center gap-2 rounded-(--radius-control) border border-(--color-border)',
              'bg-(--color-surface) px-3 py-2 text-start text-small text-(--color-text) outline-none',
              'transition-colors duration-(--duration-fast) hover:border-(--color-border-strong)',
              'focus-visible:ring-2 focus-visible:ring-(--color-ring)/25',
              'data-[state=checked]:border-(--color-primary) data-[state=checked]:bg-(--color-surface-raised)',
              'data-[state=checked]:font-medium',
              error ? 'border-(--color-error)' : null,
            )}
          >
            {option.swatch ? (
              <span
                aria-hidden="true"
                className="size-4 shrink-0 rounded-(--radius-full) border border-(--color-border-strong)"
                style={{ background: option.swatch }}
              />
            ) : null}
            <span>{option.label}</span>
            <Check
              aria-hidden="true"
              className="ms-auto size-4 shrink-0 text-(--color-primary) opacity-0 group-data-[state=checked]:opacity-100"
            />
          </RadixRadioGroup.Item>
        ))}
      </RadixRadioGroup.Root>
      {error ? (
        <p id={errorId} className="text-small text-(--color-error)">
          {error}
        </p>
      ) : null}
    </div>
  );
}
