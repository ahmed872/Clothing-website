import { z } from 'zod';

import { parseMeasurementInput } from '@/modules/body-profile';

import {
  GARMENT_MEASUREMENT_BOUNDS,
  GARMENT_MEASUREMENT_KEYS,
  GARMENT_TYPES,
  type GarmentMeasurementKey,
  type GarmentType,
  type SizeChartMeasurements,
} from './garment-types';
import { chartMeasurementsFor, requiredChartMeasurementsFor } from './sizing-rules';

/**
 * The one validation every size-chart write goes through (clothing P02).
 * The admin action and `saveProductSizing` both parse with it; the service
 * then checks what a schema cannot — that the size option and every size
 * really belong to *this* product.
 *
 * Messages are codes, laid out by where they belong
 * (`sizeChartErrorsFromIssues`), so the editor can put each one beside its
 * cell and say it in the admin's language.
 */

export type SizeChartErrorCode =
  | 'required'
  | 'invalid_option'
  | 'invalid_number'
  | 'too_small'
  | 'too_large'
  | 'not_applicable'
  | 'duplicate_size'
  | 'too_many_sizes'
  | 'size_option_required'
  | 'unknown_field';

/** No product in this store sells more sizes than this; a longer list is a
 * malformed request, not a chart. */
export const MAX_SIZE_CHART_ROWS = 40;

const uuid = z.uuid({ error: () => 'invalid_option' });

const entrySchema = z
  .object({
    optionValueId: uuid,
    measurements: z.record(z.string(), z.unknown(), { error: () => 'invalid_option' }).default({}),
  })
  .strict();

export const sizeChartInputSchema = z
  .object({
    garmentType: z.enum(GARMENT_TYPES, {
      error: (issue) =>
        issue.input === undefined || issue.input === '' ? 'required' : 'invalid_option',
    }),
    sizeOptionId: uuid.nullable().default(null),
    entries: z
      .array(entrySchema, { error: () => 'invalid_option' })
      .max(MAX_SIZE_CHART_ROWS, { error: () => 'too_many_sizes' })
      .default([]),
  })
  .strict()
  .transform((input, ctx) => {
    const applicable = new Set<string>(chartMeasurementsFor(input.garmentType));
    const required = requiredChartMeasurementsFor(input.garmentType);
    const known = new Set<string>(GARMENT_MEASUREMENT_KEYS);

    if (input.entries.length > 0 && !input.sizeOptionId) {
      ctx.addIssue({ code: 'custom', path: ['sizeOptionId'], message: 'size_option_required' });
    }

    const seen = new Set<string>();
    const entries = input.entries.map((entry, index) => {
      if (seen.has(entry.optionValueId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index, 'optionValueId'],
          message: 'duplicate_size',
        });
      }
      seen.add(entry.optionValueId);

      const measurements: SizeChartMeasurements = {};
      for (const [key, raw] of Object.entries(entry.measurements)) {
        const path = ['entries', index, key];
        if (!known.has(key)) {
          ctx.addIssue({ code: 'custom', path, message: 'unknown_field' });
          continue;
        }
        const value = parseMeasurementInput(raw);
        if (value === null) continue; // an empty cell is "not given"
        if (!applicable.has(key)) {
          ctx.addIssue({ code: 'custom', path, message: 'not_applicable' });
          continue;
        }
        if (value === 'invalid') {
          ctx.addIssue({ code: 'custom', path, message: 'invalid_number' });
          continue;
        }
        const { min, max } = GARMENT_MEASUREMENT_BOUNDS[key as GarmentMeasurementKey];
        if (value < min) ctx.addIssue({ code: 'custom', path, message: 'too_small' });
        else if (value > max) ctx.addIssue({ code: 'custom', path, message: 'too_large' });
        else measurements[key as GarmentMeasurementKey] = value;
      }
      for (const key of required) {
        const raw = entry.measurements[key];
        if (parseMeasurementInput(raw) === null) {
          ctx.addIssue({ code: 'custom', path: ['entries', index, key], message: 'required' });
        }
      }
      return { optionValueId: entry.optionValueId, measurements };
    });

    return { garmentType: input.garmentType, sizeOptionId: input.sizeOptionId, entries };
  });

export type SizeChartInput = z.input<typeof sizeChartInputSchema>;
export interface SizeChartData {
  garmentType: GarmentType;
  sizeOptionId: string | null;
  entries: { optionValueId: string; measurements: SizeChartMeasurements }[];
}

/** Where an error belongs: the whole chart, a top-level field, or one cell
 * of one row (`measurement` is `optionValueId` for the size itself). */
export interface SizeChartFieldErrors {
  form?: SizeChartErrorCode;
  garmentType?: SizeChartErrorCode;
  sizeOptionId?: SizeChartErrorCode;
  entries?: Record<
    number,
    Partial<Record<GarmentMeasurementKey | 'optionValueId', SizeChartErrorCode>>
  >;
}

const KNOWN_CODES = new Set<string>([
  'required',
  'invalid_option',
  'invalid_number',
  'too_small',
  'too_large',
  'not_applicable',
  'duplicate_size',
  'too_many_sizes',
  'size_option_required',
  'unknown_field',
]);

export function sizeChartErrorsFromIssues(
  issues: readonly z.core.$ZodIssue[],
): SizeChartFieldErrors {
  const errors: SizeChartFieldErrors = {};
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      errors.form ??= 'unknown_field';
      continue;
    }
    const code = (
      KNOWN_CODES.has(issue.message) ? issue.message : 'invalid_option'
    ) as SizeChartErrorCode;
    const [first, index, cell] = issue.path;
    if (first === 'entries' && typeof index === 'number' && typeof cell === 'string') {
      errors.entries ??= {};
      const row = (errors.entries[index] ??= {});
      row[cell as GarmentMeasurementKey | 'optionValueId'] ??= code;
    } else if (first === 'garmentType' || first === 'sizeOptionId') {
      errors[first] ??= code;
    } else {
      errors.form ??= code;
    }
  }
  return errors;
}
