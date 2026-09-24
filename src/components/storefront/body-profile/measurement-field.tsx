'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * One measurement: its label, required/optional, the unit beside the value,
 * a one-line "how to measure", and the server's error for it.
 *
 * A text field with `inputMode="decimal"`, not `type="number"`: a number
 * input would reject Arabic-Indic digits and the Arabic decimal separator
 * (which the server accepts), and would show the browser's own validation
 * messages instead of the store's. The value and its unit are always laid
 * out left-to-right, even on an Arabic page — the same rule prices follow.
 * The unit is part of the accessible name, so a screen reader hears
 * "Height (cm)", not a bare number field.
 */
export function MeasurementField({
  id,
  name,
  label,
  help,
  unit,
  required,
  requiredMark,
  optionalMark,
  value,
  onChange,
  error,
}: {
  id: string;
  name: string;
  label: string;
  help: string;
  unit: string;
  required: boolean;
  requiredMark: string;
  optionalMark: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>
          {label}
          <span className="sr-only"> ({unit})</span>
        </Label>
        <span className="text-caption text-(--color-text-subtle)">
          {required ? requiredMark : optionalMark}
        </span>
      </div>
      <div className="relative" dir="ltr">
        <Input
          id={id}
          name={name}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${errorId} ${helpId}` : helpId}
          className="pe-12 tabular-nums"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-small text-(--color-text-muted)"
        >
          {unit}
        </span>
      </div>
      <p id={helpId} className="text-caption text-(--color-text-muted)">
        {help}
      </p>
      {error ? (
        <p id={errorId} className="text-small text-(--color-error)">
          {error}
        </p>
      ) : null}
    </div>
  );
}
