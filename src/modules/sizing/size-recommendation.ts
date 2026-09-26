import type { OptionalMeasurementKey, SizingProfile } from '@/modules/body-profile';

import type {
  FitPreference,
  GarmentMeasurementKey,
  GarmentType,
  SizeChartMeasurements,
} from './garment-types';

/**
 * The size recommendation contract (clothing P02). Declared in P01 from the
 * profile side, completed here with the product side, and implemented by
 * `RuleBasedSizeRecommendationService` — the only implementation, and a
 * deterministic one: the same profile, chart and fit preference always give
 * the same answer.
 *
 * What the contract guarantees to every caller:
 *   - a recommendation only ever names a size from the request's chart —
 *     which is built from the product's own size option values;
 *   - "not enough to go on" is an answer of its own (`insufficient_data`,
 *     `no_size_data`, `no_matching_size`), never a low-confidence guess;
 *   - reasons are codes, not sentences, so the storefront can say them in
 *     either language, and they never carry a body measurement's value.
 */

/** One size in a product's chart, smallest first in the request. */
export interface SizeChartRow {
  /** The product option value this size is — what the shopper selects. */
  sizeId: string;
  label: { ar: string; en: string };
  measurements: SizeChartMeasurements;
}

export interface SizeRecommendationRequest {
  profile: SizingProfile;
  garmentType: GarmentType;
  /** Ordered smallest to largest. */
  sizeChart: readonly SizeChartRow[];
  /** Defaults to the profile's saved preference. */
  fitPreference?: FitPreference;
}

export type SizeConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

/** How one garment measurement sits on the customer, relative to the room
 * their fit preference asks for. */
export type MeasurementFit = 'fits' | 'snug' | 'loose' | 'too_tight' | 'too_loose';

export interface MeasurementComparison {
  measurement: GarmentMeasurementKey;
  fit: MeasurementFit;
}

/** A body measurement the customer can add to their profile. */
export type ProfileMeasurementKey = 'heightCm' | 'waistCm' | OptionalMeasurementKey;

export type SizeRecommendationReason =
  | { code: 'measurement'; measurement: GarmentMeasurementKey; fit: MeasurementFit }
  | { code: 'fit_preference'; fitPreference: FitPreference }
  /** Length was compared with an estimate from the customer's height. */
  | { code: 'length_from_height' }
  /** Another size scored almost as well; it is among the alternatives. */
  | { code: 'between_sizes'; otherSizeId: string }
  /** These optional measurements would make the result more precise. */
  | { code: 'limited_measurements'; missing: readonly ProfileMeasurementKey[] };

export interface SizeAlternative {
  sizeId: string;
  /** Relative to the recommended size: `smaller` fits closer, `larger`
   * looser. */
  direction: 'smaller' | 'larger';
  score: number;
}

export interface SizeFit {
  sizeId: string;
  /** 0–100. */
  score: number;
  comparisons: readonly MeasurementComparison[];
}

export interface SizeRecommendation {
  recommendedSizeId: string;
  confidence: SizeConfidence;
  /** 0–100: the recommended size's weighted compatibility. */
  score: number;
  fitPreference: FitPreference;
  reasons: readonly SizeRecommendationReason[];
  /** Neighbouring sizes worth trying, best first; never the recommended one. */
  alternatives: readonly SizeAlternative[];
  /** Every size in chart order, for a fitting room that shows how a
   * manually chosen size would sit. */
  sizes: readonly SizeFit[];
}

export type SizeRecommendationResult =
  | { status: 'recommended'; recommendation: SizeRecommendation }
  /** The customer's profile lacks a measurement this garment needs. */
  | { status: 'insufficient_data'; missing: readonly ProfileMeasurementKey[] }
  /** The product has no chart, or its chart lacks what this garment needs. */
  | { status: 'no_size_data'; reason: 'no_chart' | 'chart_incomplete' }
  /** Every size is well outside the customer's measurements — `above`
   * when the customer measures larger than the largest size, `below` when
   * smaller than the smallest. */
  | {
      status: 'no_matching_size';
      direction: 'above' | 'below' | 'mixed';
      /** The fit that was aimed for — another may find a size. */
      fitPreference: FitPreference;
    };

export interface SizeRecommendationService {
  recommend(request: SizeRecommendationRequest): Promise<SizeRecommendationResult>;
}
