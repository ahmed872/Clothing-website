import type { BodyProfileGender, BodyShape } from '@generated/prisma';

import type { BodyProfileView } from './body-profile.service';
import type { OptionalMeasurementKey } from './options';

/**
 * The contract the size recommendation engine (clothing P02) will implement
 * — and only the contract. Nothing in this phase recommends a size: there is
 * no implementation to call, so no page can show a made-up answer, a random
 * size or a guess dressed up as advice.
 *
 * What the contract fixes now, so P02 cannot drift from it:
 *   - measurements are the input that decides; `bodyShape` travels along
 *     as a hint only, and `weightKg` is context, never a sizing rule of its
 *     own;
 *   - the product side is the product and its real variants' size values —
 *     a recommendation can only ever name a size the product is sold in;
 *   - "not enough to go on" is a first-class answer (`insufficient_data`,
 *     naming what is missing), never a low-confidence guess.
 *
 * Structural product types rather than `@/modules/catalog` imports, so this
 * module keeps depending on `core` alone until the engine needs more.
 */

/** Everything sizing may read from a body profile, and nothing else — no
 * appearance data, no customer id. */
export interface SizingProfile {
  gender: BodyProfileGender;
  heightCm: number;
  waistCm: number;
  optional: Record<OptionalMeasurementKey, number | null>;
  /** Context only — never the basis of a recommendation on its own. */
  weightKg: number;
  /** Advisory, derived from the measurements above; may be null. */
  bodyShape: BodyShape | null;
}

export interface SizeRecommendationRequest {
  profile: SizingProfile;
  product: { productId: string; categoryId: string };
  /** The product's purchasable sizes: each variant and the value of its
   * size option (`'M'`, `'54'`, `'4-5Y'`, …). */
  variants: readonly { variantId: string; size: string }[];
}

export type SizeRecommendationConfidence = 'high' | 'medium' | 'low';

export interface SizeRecommendation {
  /** Always one of `request.variants[].size`. */
  recommendedSize: string;
  confidence: SizeRecommendationConfidence;
  /** A reason the storefront can put into words in either language — a
   * code plus the measurements it rested on, not a sentence. */
  reason: {
    code: string;
    basedOn: readonly (keyof SizingProfile['optional'] | 'heightCm' | 'waistCm')[];
  };
  /** Other sizes worth trying, nearest first; never includes the
   * recommended one. */
  alternativeSizes: readonly string[];
}

export type SizeRecommendationResult =
  | { status: 'recommended'; recommendation: SizeRecommendation }
  | { status: 'insufficient_data'; missing: readonly OptionalMeasurementKey[] }
  | { status: 'no_size_data' };

export interface SizeRecommendationService {
  recommend(request: SizeRecommendationRequest): Promise<SizeRecommendationResult>;
}

/** The profile as sizing sees it. Pure, so the engine can be tested against
 * plain objects. */
export function toSizingProfile(profile: BodyProfileView): SizingProfile {
  const { heightCm, weightKg, waistCm, ...optional } = profile.measurements;
  return {
    gender: profile.gender,
    heightCm,
    waistCm,
    optional,
    weightKg,
    bodyShape: profile.bodyShape,
  };
}
