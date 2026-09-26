import type { BodyProfileGender, BodyShape, FitPreference } from '@generated/prisma';

import type { BodyProfileView } from './body-profile.service';
import type { OptionalMeasurementKey } from './options';

/**
 * The profile as sizing sees it — the body-profile side of the size
 * recommendation contract.
 *
 * P01 declared the whole contract here, before any engine existed. P02's
 * engine lives in `@/modules/sizing`, which depends on this module (it reads
 * profiles), so the service interface moved there with its implementation;
 * what stays here is the one thing only this module can define: which parts
 * of a profile sizing is allowed to read.
 *
 * What it fixes, so no engine can drift from it:
 *   - measurements are the input that decides; `bodyShape` travels along as
 *     a hint only, and `weightKg` is context, never a sizing rule of its own;
 *   - no appearance data and no customer id ever reach sizing.
 */
export interface SizingProfile {
  gender: BodyProfileGender;
  heightCm: number;
  waistCm: number;
  optional: Record<OptionalMeasurementKey, number | null>;
  /** Context only — never the basis of a recommendation on its own. */
  weightKg: number;
  /** Advisory, derived from the measurements above; may be null. */
  bodyShape: BodyShape | null;
  /** The customer's saved default; a product page may ask for another. */
  fitPreference: FitPreference;
}

/** Pure, so the engine can be tested against plain objects. */
export function toSizingProfile(profile: BodyProfileView): SizingProfile {
  const { heightCm, weightKg, waistCm, ...optional } = profile.measurements;
  return {
    gender: profile.gender,
    heightCm,
    waistCm,
    optional,
    weightKg,
    bodyShape: profile.bodyShape,
    fitPreference: profile.fitPreference,
  };
}
