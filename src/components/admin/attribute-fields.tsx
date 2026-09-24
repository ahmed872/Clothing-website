'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AttributeFieldDefinition } from '@/lib/admin/product-actions';
import type { Locale } from '@/lib/i18n/locales';

export type AttributeValues = Record<string, unknown>;

/**
 * The category's attribute schema, rendered as an actual form — P07 §6: a
 * store owner never types `{"fuel_type": "Petrol"}`. Each definition's
 * `type` picks the control (a select for SELECT, checkboxes for
 * MULTI_SELECT, a switch for BOOLEAN, a number input with its unit for
 * NUMBER), and the value that comes back out is already the right JS type
 * for the JSON column — the server still validates it against the same
 * definitions before anything is stored.
 */
export function AttributeFields({
  definitions,
  values,
  onChange,
  locale,
  labels,
}: {
  definitions: AttributeFieldDefinition[];
  values: AttributeValues;
  onChange: (values: AttributeValues) => void;
  locale: Locale;
  labels: { noneOption: string; emptyDescription: string };
}) {
  if (definitions.length === 0) {
    return <p className="text-small text-(--color-text-muted)">{labels.emptyDescription}</p>;
  }

  function set(key: string, value: unknown): void {
    const next = { ...values };
    // An empty value is an absent value, not `""` — the JSON column should
    // not accumulate blanks for optional fields the admin left alone.
    if (value === '' || value === undefined || (Array.isArray(value) && value.length === 0)) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-5">
      {definitions.map((definition) => {
        const id = `attr-field-${definition.key}`;
        const label = locale === 'ar' ? definition.labelAr : definition.labelEn;
        const labelWithUnit = definition.unit ? `${label} (${definition.unit})` : label;
        const value = values[definition.key];

        return (
          <div key={definition.key} className="flex flex-col gap-1.5">
            {definition.type === 'BOOLEAN' ? (
              <div className="flex items-center justify-between gap-3 rounded-(--radius-control) border border-(--color-border) p-3">
                <Label htmlFor={id} className="cursor-pointer">
                  {labelWithUnit}
                  {definition.required ? (
                    <span className="ms-1 text-(--color-error)">*</span>
                  ) : null}
                </Label>
                <Switch
                  id={id}
                  checked={value === true}
                  onCheckedChange={(checked) => set(definition.key, checked)}
                />
              </div>
            ) : (
              <>
                <Label htmlFor={id}>
                  {labelWithUnit}
                  {definition.required ? (
                    <span className="ms-1 text-(--color-error)">*</span>
                  ) : null}
                </Label>

                {definition.type === 'TEXT' ? (
                  <Input
                    id={id}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(event) => set(definition.key, event.target.value)}
                  />
                ) : null}

                {definition.type === 'NUMBER' ? (
                  <Input
                    id={id}
                    type="number"
                    inputMode="decimal"
                    className="tabular-nums"
                    value={typeof value === 'number' ? String(value) : ''}
                    onChange={(event) =>
                      set(
                        definition.key,
                        event.target.value === '' ? '' : Number(event.target.value),
                      )
                    }
                  />
                ) : null}

                {definition.type === 'SELECT' ? (
                  <Select
                    value={typeof value === 'string' ? value : ''}
                    onValueChange={(next) => set(definition.key, next)}
                  >
                    <SelectTrigger id={id}>
                      <SelectValue>
                        {typeof value === 'string' && value ? value : labels.noneOption}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(definition.allowedValues ?? []).map((allowed) => (
                        <SelectItem key={allowed} value={allowed}>
                          {allowed}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}

                {definition.type === 'MULTI_SELECT' ? (
                  <div className="flex flex-wrap gap-3 pt-1">
                    {(definition.allowedValues ?? []).map((allowed) => {
                      const selected = Array.isArray(value) ? (value as string[]) : [];
                      const checkboxId = `${id}-${allowed}`;
                      return (
                        <label
                          key={allowed}
                          htmlFor={checkboxId}
                          className="flex cursor-pointer items-center gap-2 text-sm text-(--color-text)"
                        >
                          <Checkbox
                            id={checkboxId}
                            checked={selected.includes(allowed)}
                            onCheckedChange={(checked) =>
                              set(
                                definition.key,
                                checked
                                  ? [...selected, allowed]
                                  : selected.filter((v) => v !== allowed),
                              )
                            }
                          />
                          {allowed}
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
