import type { FitPreference, GarmentType } from '@generated/prisma';

/**
 * The closed lists and bounds a size chart is built from — dependency-free
 * (type-only imports), so the admin editor renders the same columns and
 * limits the server validates against, and the storefront reads the same
 * garment names. The same discipline as `body-profile/options.ts`.
 */

/** Display order in the admin's garment picker: tops, then one-piece and
 * traditional garments, then bottoms. */
export const GARMENT_TYPES = [
  'T_SHIRT',
  'SHIRT',
  'HOODIE',
  'SWEATER',
  'JACKET',
  'CARDIGAN',
  'DRESS',
  'ABAYA',
  'THOBE',
  'JEANS',
  'TROUSERS',
  'SHORTS',
  'SKIRT',
] as const satisfies readonly GarmentType[];

export type { FitPreference, GarmentType };

/**
 * Every measurement a size chart can hold, in the order a chart shows them.
 * These are *garment* measurements — the garment laid flat and measured,
 * circumferences given in full (a chest of 108 means 54 across, doubled).
 */
export const GARMENT_MEASUREMENT_KEYS = [
  'chestCm',
  'waistCm',
  'hipCm',
  'shoulderCm',
  'sleeveCm',
  'inseamCm',
  'lengthCm',
  'neckCm',
] as const;
export type GarmentMeasurementKey = (typeof GARMENT_MEASUREMENT_KEYS)[number];
export type SizeChartMeasurements = Partial<Record<GarmentMeasurementKey, number>>;

/**
 * Realistic garment bounds, inclusive, in centimetres. Wide on purpose —
 * children's sizes and full-length garments both fit — they exist to catch
 * a slipped digit or an inch entered as a centimetre, and every one fits
 * the `Decimal(4,1)` column.
 */
export const GARMENT_MEASUREMENT_BOUNDS: Record<
  GarmentMeasurementKey,
  { min: number; max: number }
> = {
  chestCm: { min: 30, max: 250 },
  waistCm: { min: 20, max: 250 },
  hipCm: { min: 30, max: 260 },
  shoulderCm: { min: 15, max: 80 },
  sleeveCm: { min: 5, max: 110 },
  inseamCm: { min: 10, max: 130 },
  lengthCm: { min: 20, max: 200 },
  neckCm: { min: 20, max: 70 },
};

type Exhaustive<Enum, Listed> = [Exclude<Enum, Listed>] extends [never] ? true : never;
/** Compile-time only: fails to type-check if the list misses an enum value. */
export const GARMENT_TYPES_ARE_EXHAUSTIVE: Exhaustive<GarmentType, (typeof GARMENT_TYPES)[number]> =
  true;
