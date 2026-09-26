import type {
  GarmentLength,
  GarmentPattern,
  GarmentType,
  Neckline,
  SleeveLength,
} from '@generated/prisma';

/**
 * How a garment is worn and drawn (clothing P04) — the fitting room's
 * product metadata, beside the size chart. Dependency-free (type-only
 * imports) so the admin editor, the fitting room and the avatar's garment
 * layers read the same lists and defaults.
 *
 * Fit and material are not here: they are the catalog's own product
 * attributes (`fit`, `material`), read where they are needed rather than
 * stored twice.
 */

export const SLEEVE_LENGTHS = [
  'SLEEVELESS',
  'SHORT',
  'THREE_QUARTER',
  'LONG',
] as const satisfies readonly SleeveLength[];
export const NECKLINES = [
  'CREW',
  'SCOOP',
  'V_NECK',
  'COLLAR',
  'BAND',
  'HOOD',
] as const satisfies readonly Neckline[];
export const GARMENT_LENGTHS = [
  'CROPPED',
  'HIP',
  'THIGH',
  'KNEE',
  'MIDI',
  'ANKLE',
  'FLOOR',
] as const satisfies readonly GarmentLength[];
export const GARMENT_PATTERNS = [
  'SOLID',
  'STRIPED',
  'CHECKED',
  'FLORAL',
  'DOTTED',
] as const satisfies readonly GarmentPattern[];

export type { GarmentLength, GarmentPattern, Neckline, SleeveLength };

/**
 * Where a garment sits on the avatar: a `top` (over the base top), an
 * `outer` layer over whatever top is worn, a `full` garment from shoulders
 * down (it replaces top and bottom), or a `bottom`.
 */
export type GarmentLayerKind = 'top' | 'outer' | 'full' | 'bottom';

export const GARMENT_LAYER_KIND: Record<GarmentType, GarmentLayerKind> = {
  T_SHIRT: 'top',
  SHIRT: 'top',
  HOODIE: 'top',
  SWEATER: 'top',
  JACKET: 'outer',
  CARDIGAN: 'outer',
  DRESS: 'full',
  ABAYA: 'full',
  THOBE: 'full',
  JEANS: 'bottom',
  TROUSERS: 'bottom',
  SHORTS: 'bottom',
  SKIRT: 'bottom',
};

export interface GarmentStyle {
  /** Null for garments without sleeves to speak of (bottoms). */
  sleeveLength: SleeveLength | null;
  neckline: Neckline | null;
  length: GarmentLength;
  pattern: GarmentPattern;
}

/** What each garment type looks like unless the product says otherwise. */
export const GARMENT_STYLE_DEFAULTS: Record<GarmentType, GarmentStyle> = {
  T_SHIRT: { sleeveLength: 'SHORT', neckline: 'CREW', length: 'HIP', pattern: 'SOLID' },
  SHIRT: { sleeveLength: 'LONG', neckline: 'COLLAR', length: 'HIP', pattern: 'SOLID' },
  HOODIE: { sleeveLength: 'LONG', neckline: 'HOOD', length: 'HIP', pattern: 'SOLID' },
  SWEATER: { sleeveLength: 'LONG', neckline: 'CREW', length: 'HIP', pattern: 'SOLID' },
  JACKET: { sleeveLength: 'LONG', neckline: 'COLLAR', length: 'HIP', pattern: 'SOLID' },
  CARDIGAN: { sleeveLength: 'LONG', neckline: 'V_NECK', length: 'HIP', pattern: 'SOLID' },
  DRESS: { sleeveLength: 'SHORT', neckline: 'SCOOP', length: 'KNEE', pattern: 'SOLID' },
  ABAYA: { sleeveLength: 'LONG', neckline: 'BAND', length: 'FLOOR', pattern: 'SOLID' },
  THOBE: { sleeveLength: 'LONG', neckline: 'BAND', length: 'ANKLE', pattern: 'SOLID' },
  JEANS: { sleeveLength: null, neckline: null, length: 'ANKLE', pattern: 'SOLID' },
  TROUSERS: { sleeveLength: null, neckline: null, length: 'ANKLE', pattern: 'SOLID' },
  SHORTS: { sleeveLength: null, neckline: null, length: 'THIGH', pattern: 'SOLID' },
  SKIRT: { sleeveLength: null, neckline: null, length: 'MIDI', pattern: 'SOLID' },
};

/** Which style fields a product may set for its garment type — sleeves
 * and necklines mean nothing on trousers. */
export function styleFieldsFor(garmentType: GarmentType): {
  sleeveLength: boolean;
  neckline: boolean;
  length: boolean;
} {
  const kind = GARMENT_LAYER_KIND[garmentType];
  return { sleeveLength: kind !== 'bottom', neckline: kind !== 'bottom', length: true };
}

export interface GarmentStyleOverrides {
  sleeveLength: SleeveLength | null;
  neckline: Neckline | null;
  garmentLength: GarmentLength | null;
  pattern: GarmentPattern | null;
}

/** The style to draw: each override where the product set one, the
 * garment type's default elsewhere. */
export function resolveGarmentStyle(
  garmentType: GarmentType,
  overrides: Partial<GarmentStyleOverrides> = {},
): GarmentStyle {
  const defaults = GARMENT_STYLE_DEFAULTS[garmentType];
  const fields = styleFieldsFor(garmentType);
  return {
    sleeveLength: fields.sleeveLength ? (overrides.sleeveLength ?? defaults.sleeveLength) : null,
    neckline: fields.neckline ? (overrides.neckline ?? defaults.neckline) : null,
    length: overrides.garmentLength ?? defaults.length,
    pattern: overrides.pattern ?? defaults.pattern,
  };
}

/** `#rrggbb`, and nothing else, reaches a swatch. */
export const SWATCH_HEX = /^#[0-9A-Fa-f]{6}$/;
