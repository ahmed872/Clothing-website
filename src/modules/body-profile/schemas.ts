import { z } from 'zod';

import { checkMeasurement } from './measurement-input';
import {
  FACIAL_HAIR,
  GENDERS,
  GLASSES_FRAME_COLORS,
  GLASSES_STYLES,
  HAIR_COLORS,
  HAIR_STYLES,
  SKIN_TONES,
  type MeasurementKey,
} from './options';

/**
 * The one validation every body-profile write goes through — the server
 * action parses the form with it, and `saveBodyProfile` parses again, so no
 * caller can reach the database around it.
 *
 * Messages are codes, not sentences (`required`, `too_small`, …): the form
 * turns each into a localised message with the field's own bounds, which is
 * what `fieldErrorsFromIssues` below is for.
 *
 * `.strict()` on both objects is mass-assignment protection: a
 * `customerId`, an `id`, a `bodyShape` (derived, never supplied) or any
 * other key a crafted request adds is a validation error, not something
 * quietly passed through to a write.
 */

export type BodyProfileErrorCode =
  'required' | 'invalid_number' | 'too_small' | 'too_large' | 'invalid_option' | 'unknown_field';

function measurement(key: MeasurementKey) {
  // `.optional()` before the transform so an absent key reaches it (as
  // "not entered") instead of failing as a missing key — Zod 4 decides a
  // key's optionality from the input side of the pipe.
  return z
    .unknown()
    .optional()
    .transform((raw, ctx) => {
      const { value, problem } = checkMeasurement(key, raw);
      if (problem) {
        ctx.addIssue({ code: 'custom', message: problem });
        return z.NEVER;
      }
      return value;
    });
}

function requiredMeasurement(key: MeasurementKey) {
  return measurement(key).pipe(z.number({ error: () => 'required' }));
}

function choice<const T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values, {
    error: (issue) =>
      issue.input === undefined || issue.input === '' ? 'required' : 'invalid_option',
  });
}

/** An appearance choice the customer may leave unset: absent, `null` and
 * `''` (an untouched radio group or select) all mean "not chosen". */
function optionalChoice<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .unknown()
    .optional()
    .transform((raw) => (raw === '' || raw === undefined ? null : raw))
    .pipe(choice(values).nullable());
}

export const avatarConfigurationInputSchema = z
  .object({
    skinTone: optionalChoice(SKIN_TONES),
    hairStyle: optionalChoice(HAIR_STYLES),
    hairColor: optionalChoice(HAIR_COLORS),
    facialHair: optionalChoice(FACIAL_HAIR),
    wearsGlasses: z.boolean({ error: () => 'invalid_option' }).default(false),
    glassesStyle: optionalChoice(GLASSES_STYLES),
    glassesFrameColor: optionalChoice(GLASSES_FRAME_COLORS),
  })
  .strict()
  // Glasses details only mean something while glasses are on — cleared
  // rather than rejected, so turning the switch off and saving just works.
  // The table's CHECK constraint holds the same rule.
  .transform((avatar) =>
    avatar.wearsGlasses ? avatar : { ...avatar, glassesStyle: null, glassesFrameColor: null },
  );
export type AvatarConfigurationInput = z.input<typeof avatarConfigurationInputSchema>;
export type AvatarConfigurationData = z.output<typeof avatarConfigurationInputSchema>;

export const bodyProfileInputSchema = z
  .object({
    gender: choice(GENDERS),
    heightCm: requiredMeasurement('heightCm'),
    weightKg: requiredMeasurement('weightKg'),
    waistCm: requiredMeasurement('waistCm'),
    chestCm: measurement('chestCm'),
    hipCm: measurement('hipCm'),
    shoulderCm: measurement('shoulderCm'),
    inseamCm: measurement('inseamCm'),
    sleeveLengthCm: measurement('sleeveLengthCm'),
    neckCm: measurement('neckCm'),
    // `prefault`, not `default`: an omitted avatar is parsed like `{}`, so it
    // still goes through the glasses rule and comes out fully shaped.
    avatar: avatarConfigurationInputSchema.prefault({}),
  })
  .strict();
export type BodyProfileInput = z.input<typeof bodyProfileInputSchema>;
export type BodyProfileData = z.output<typeof bodyProfileInputSchema>;

/** Every field a form can show an error beside — avatar fields flattened to
 * their own names (`skinTone`, not `avatar.skinTone`). */
export type BodyProfileField =
  keyof Omit<BodyProfileData, 'avatar'> | keyof AvatarConfigurationData | 'form';

const KNOWN_CODES = new Set<string>([
  'required',
  'invalid_number',
  'too_small',
  'too_large',
  'invalid_option',
]);

/** Zod issues → one error code per field (the first wins). An unexpected
 * key is reported against the form as a whole, since there is no field on
 * screen for it. */
export function fieldErrorsFromIssues(
  issues: readonly z.core.$ZodIssue[],
): Partial<Record<BodyProfileField, BodyProfileErrorCode>> {
  const errors: Partial<Record<BodyProfileField, BodyProfileErrorCode>> = {};
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      errors.form ??= 'unknown_field';
      continue;
    }
    const path = issue.path.filter((segment) => segment !== 'avatar');
    const field = (path[0] ?? 'form') as BodyProfileField;
    const code = KNOWN_CODES.has(issue.message)
      ? (issue.message as BodyProfileErrorCode)
      : 'invalid_option';
    errors[field] ??= code;
  }
  return errors;
}
