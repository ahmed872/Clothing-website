import type {
  BodyProfileGender,
  BodyShape,
  FacialHair,
  GlassesFrameColor,
  GlassesStyle,
  HairColor,
  HairStyle,
  SkinTone,
} from '@generated/prisma';

/**
 * The closed lists and bounds a body profile is built from — dependency-free
 * (type-only imports) so the storefront form can render the same options the
 * server validates against, the way `@/modules/core/env.client` is shared.
 * Order here is display order.
 *
 * Each list is checked against its Prisma enum below, in both directions:
 * `satisfies` rejects a value the database would not accept, and the
 * `Exhaustive` checks reject a database value the form would never offer.
 */

export const GENDERS = [
  'FEMALE',
  'MALE',
  'OTHER',
  'PREFER_NOT_TO_SAY',
] as const satisfies readonly BodyProfileGender[];

export const SKIN_TONES = [
  'LIGHT',
  'MEDIUM_LIGHT',
  'MEDIUM',
  'MEDIUM_DARK',
  'DARK',
] as const satisfies readonly SkinTone[];

export const HAIR_STYLES = [
  'SHORT',
  'MEDIUM',
  'LONG',
  'STRAIGHT',
  'WAVY',
  'CURLY',
  'BUZZ',
  'COVERED',
] as const satisfies readonly HairStyle[];

export const HAIR_COLORS = [
  'BLACK',
  'DARK_BROWN',
  'BROWN',
  'LIGHT_BROWN',
  'BLONDE',
  'RED',
  'GRAY',
  'WHITE',
] as const satisfies readonly HairColor[];

export const FACIAL_HAIR = [
  'NONE',
  'SHORT_BEARD',
  'LONG_BEARD',
  'MUSTACHE',
] as const satisfies readonly FacialHair[];

export const GLASSES_STYLES = [
  'ROUND',
  'RECTANGULAR',
  'AVIATOR',
  'CAT_EYE',
] as const satisfies readonly GlassesStyle[];

export const GLASSES_FRAME_COLORS = [
  'BLACK',
  'BROWN',
  'GOLD',
  'SILVER',
  'CLEAR',
] as const satisfies readonly GlassesFrameColor[];

export const BODY_SHAPES = [
  'STRAIGHT',
  'DEFINED_WAIST',
  'HIPS_WIDER',
  'CHEST_WIDER',
  'WAIST_WIDEST',
] as const satisfies readonly BodyShape[];

type Exhaustive<Enum, Listed> = [Exclude<Enum, Listed>] extends [never] ? true : never;
/** Compile-time only: fails to type-check if a list above misses an enum value. */
export const OPTION_LISTS_ARE_EXHAUSTIVE: [
  Exhaustive<BodyProfileGender, (typeof GENDERS)[number]>,
  Exhaustive<SkinTone, (typeof SKIN_TONES)[number]>,
  Exhaustive<HairStyle, (typeof HAIR_STYLES)[number]>,
  Exhaustive<HairColor, (typeof HAIR_COLORS)[number]>,
  Exhaustive<FacialHair, (typeof FACIAL_HAIR)[number]>,
  Exhaustive<GlassesStyle, (typeof GLASSES_STYLES)[number]>,
  Exhaustive<GlassesFrameColor, (typeof GLASSES_FRAME_COLORS)[number]>,
  Exhaustive<BodyShape, (typeof BODY_SHAPES)[number]>,
] = [true, true, true, true, true, true, true, true];

/** The minimum a profile needs to be saved at all. */
export const REQUIRED_MEASUREMENTS = ['heightCm', 'weightKg', 'waistCm'] as const;

/** Each one sharpens a future size recommendation; none blocks saving. In
 * the order the form asks for them. */
export const OPTIONAL_MEASUREMENTS = [
  'chestCm',
  'hipCm',
  'shoulderCm',
  'inseamCm',
  'sleeveLengthCm',
  'neckCm',
] as const;

export type RequiredMeasurementKey = (typeof REQUIRED_MEASUREMENTS)[number];
export type OptionalMeasurementKey = (typeof OPTIONAL_MEASUREMENTS)[number];
export type MeasurementKey = RequiredMeasurementKey | OptionalMeasurementKey;

export const MEASUREMENT_KEYS: readonly MeasurementKey[] = [
  ...REQUIRED_MEASUREMENTS,
  ...OPTIONAL_MEASUREMENTS,
];

export type MeasurementUnit = 'cm' | 'kg';

/**
 * Realistic human bounds, inclusive. Wide on purpose: they exist to catch a
 * typo (a height of 1.77 meant as metres, a stray extra digit), not to
 * decide whose body counts as normal. The storage column holds up to
 * 999.9, so every bound here also fits it.
 */
export const MEASUREMENT_BOUNDS: Record<
  MeasurementKey,
  { min: number; max: number; unit: MeasurementUnit }
> = {
  heightCm: { min: 50, max: 260, unit: 'cm' },
  weightKg: { min: 10, max: 350, unit: 'kg' },
  waistCm: { min: 30, max: 250, unit: 'cm' },
  chestCm: { min: 40, max: 250, unit: 'cm' },
  hipCm: { min: 40, max: 250, unit: 'cm' },
  shoulderCm: { min: 20, max: 80, unit: 'cm' },
  inseamCm: { min: 20, max: 130, unit: 'cm' },
  sleeveLengthCm: { min: 20, max: 110, unit: 'cm' },
  neckCm: { min: 20, max: 70, unit: 'cm' },
};
