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
import {
  GARMENT_LENGTHS,
  GARMENT_PATTERNS,
  NECKLINES,
  SLEEVE_LENGTHS,
  SWATCH_HEX,
  styleFieldsFor,
  type GarmentStyleOverrides,
} from './garment-style';
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
  | 'color_option_required'
  | 'invalid_color'
  | 'duplicate_color'
  | 'unknown_field';

/** No product in this store sells more sizes than this; a longer list is a
 * malformed request, not a chart. */
export const MAX_SIZE_CHART_ROWS = 40;

const uuid = z.uuid({ error: () => 'invalid_option' });

/** A style field left unset (absent, null or `''`) means "the garment
 * type's default". */
function optionalStyle<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .unknown()
    .optional()
    .transform((raw) => (raw === '' || raw === undefined ? null : raw))
    .pipe(z.enum(values, { error: () => 'invalid_option' }).nullable());
}

const swatchSchema = z
  .object({
    optionValueId: uuid,
    hex: z
      .string({ error: () => 'invalid_color' })
      .regex(SWATCH_HEX, { error: () => 'invalid_color' }),
  })
  .strict();

/** No product has more colours than this; a longer list is malformed. */
export const MAX_SWATCHES = 40;

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
    // Clothing P04 — how the garment is drawn in the fitting room.
    colorOptionId: uuid.nullable().default(null),
    sleeveLength: optionalStyle(SLEEVE_LENGTHS),
    neckline: optionalStyle(NECKLINES),
    garmentLength: optionalStyle(GARMENT_LENGTHS),
    pattern: optionalStyle(GARMENT_PATTERNS),
    swatches: z
      .array(swatchSchema, { error: () => 'invalid_option' })
      .max(MAX_SWATCHES, { error: () => 'invalid_option' })
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

    const fields = styleFieldsFor(input.garmentType);
    if (input.sleeveLength && !fields.sleeveLength) {
      ctx.addIssue({ code: 'custom', path: ['sleeveLength'], message: 'not_applicable' });
    }
    if (input.neckline && !fields.neckline) {
      ctx.addIssue({ code: 'custom', path: ['neckline'], message: 'not_applicable' });
    }
    if (input.swatches.length > 0 && !input.colorOptionId) {
      ctx.addIssue({ code: 'custom', path: ['colorOptionId'], message: 'color_option_required' });
    }
    const seenColors = new Set<string>();
    input.swatches.forEach((swatch, index) => {
      if (seenColors.has(swatch.optionValueId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['swatches', index, 'optionValueId'],
          message: 'duplicate_color',
        });
      }
      seenColors.add(swatch.optionValueId);
    });

    return {
      garmentType: input.garmentType,
      sizeOptionId: input.sizeOptionId,
      entries,
      colorOptionId: input.colorOptionId,
      style: {
        sleeveLength: input.sleeveLength,
        neckline: input.neckline,
        garmentLength: input.garmentLength,
        pattern: input.pattern,
      },
      swatches: input.swatches.map((swatch) => ({
        optionValueId: swatch.optionValueId,
        hex: swatch.hex.toUpperCase(),
      })),
    };
  });

export type SizeChartInput = z.input<typeof sizeChartInputSchema>;
export interface SizeChartData {
  garmentType: GarmentType;
  sizeOptionId: string | null;
  entries: { optionValueId: string; measurements: SizeChartMeasurements }[];
  colorOptionId: string | null;
  style: GarmentStyleOverrides;
  swatches: { optionValueId: string; hex: string }[];
}

/** Where an error belongs: the whole chart, a top-level field, or one cell
 * of one row (`measurement` is `optionValueId` for the size itself). */
export interface SizeChartFieldErrors {
  form?: SizeChartErrorCode;
  garmentType?: SizeChartErrorCode;
  sizeOptionId?: SizeChartErrorCode;
  colorOptionId?: SizeChartErrorCode;
  sleeveLength?: SizeChartErrorCode;
  neckline?: SizeChartErrorCode;
  garmentLength?: SizeChartErrorCode;
  pattern?: SizeChartErrorCode;
  /** Per swatch row: its colour value or its hex. */
  swatches?: Record<number, Partial<Record<'optionValueId' | 'hex', SizeChartErrorCode>>>;
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
  'color_option_required',
  'invalid_color',
  'duplicate_color',
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
    } else if (first === 'swatches' && typeof index === 'number' && typeof cell === 'string') {
      errors.swatches ??= {};
      const row = (errors.swatches[index] ??= {});
      row[cell as 'optionValueId' | 'hex'] ??= code;
    } else if (
      first === 'garmentType' ||
      first === 'sizeOptionId' ||
      first === 'colorOptionId' ||
      first === 'sleeveLength' ||
      first === 'neckline' ||
      first === 'garmentLength' ||
      first === 'pattern'
    ) {
      errors[first] ??= code;
    } else {
      errors.form ??= code;
    }
  }
  return errors;
}
