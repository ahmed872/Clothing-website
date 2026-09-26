import type { SizingProfile } from '@/modules/body-profile';

import type { FitPreference, GarmentMeasurementKey } from './garment-types';
import {
  ALTERNATIVE_MIN_SCORE,
  BODY_COUNTERPART,
  CONFIDENCE,
  FULL_LENGTH_RATIO,
  GARMENT_RULES,
  LIMITED_COVERAGE_BELOW,
  SCORING,
  TIE_BREAK,
  type MeasurementRule,
} from './sizing-rules';
import type {
  MeasurementComparison,
  MeasurementFit,
  ProfileMeasurementKey,
  SizeAlternative,
  SizeConfidence,
  SizeFit,
  SizeRecommendationReason,
  SizeRecommendationRequest,
  SizeRecommendationResult,
  SizeRecommendationService,
} from './size-recommendation';

/**
 * The size engine: pure, synchronous and deterministic — no clock, no
 * randomness, no I/O. Every number it uses comes from `sizing-rules.ts`.
 *
 *   1. The garment type names the measurements that matter
 *      (`GARMENT_RULES[type].scored`) and which of them are required.
 *   2. A required measurement missing from the chart → `no_size_data`;
 *      missing from the profile → `insufficient_data`, naming it.
 *   3. For every size, each measurement both sides have is compared:
 *      `n = (garment − body − idealEase[fit]) / tolerance`, scored
 *      `1 − |n|·(TIGHT_PENALTY if short of room) / FALLOFF` (floored at 0).
 *   4. A size's score is the weighted mean; the best score wins, ties
 *      broken by `TIE_BREAK`.
 *   5. If even the best size has a required measurement too tight or too
 *      loose, nothing fits → `no_matching_size`, never a stretched guess.
 *   6. Confidence, reasons and neighbouring alternatives are derived from
 *      the same comparisons, by the rules documented beside their numbers.
 */

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function profileMeasurementKey(key: GarmentMeasurementKey): ProfileMeasurementKey {
  return BODY_COUNTERPART[key];
}

/** The body side of one comparison, or null if the customer has not
 * entered it. Length is estimated from height (see `FULL_LENGTH_RATIO`). */
function bodyValue(profile: SizingProfile, key: GarmentMeasurementKey): number | null {
  const counterpart = BODY_COUNTERPART[key];
  if (key === 'lengthCm') return round1(profile.heightCm * FULL_LENGTH_RATIO);
  if (counterpart === 'waistCm') return profile.waistCm;
  if (counterpart === 'heightCm') return profile.heightCm;
  return profile.optional[counterpart];
}

function classify(n: number): MeasurementFit {
  const magnitude = Math.abs(n);
  if (magnitude <= SCORING.FITS_WITHIN) return 'fits';
  if (magnitude <= SCORING.CLOSE_WITHIN) return n < 0 ? 'snug' : 'loose';
  return n < 0 ? 'too_tight' : 'too_loose';
}

interface ScoredComparison extends MeasurementComparison {
  rule: MeasurementRule;
  /** Signed deviation in tolerances; negative is short of the ideal room. */
  n: number;
  score: number;
}

interface ScoredSize {
  index: number;
  sizeId: string;
  score: number;
  coverage: number;
  comparisons: ScoredComparison[];
}

function compare(
  rule: MeasurementRule,
  measurement: GarmentMeasurementKey,
  garment: number,
  body: number,
  fit: FitPreference,
): ScoredComparison {
  const n = (garment - body - rule.ease[fit]) / rule.tolerance;
  const effective = n < 0 ? -n * SCORING.TIGHT_PENALTY : n;
  return {
    measurement,
    fit: classify(n),
    rule,
    n,
    score: Math.max(0, 1 - effective / SCORING.FALLOFF),
  };
}

const TOO_FAR: ReadonlySet<MeasurementFit> = new Set(['too_tight', 'too_loose']);

export function recommendSize(request: SizeRecommendationRequest): SizeRecommendationResult {
  const { profile, garmentType, sizeChart } = request;
  const fit = request.fitPreference ?? profile.fitPreference;
  const rules = GARMENT_RULES[garmentType];
  // Most important first, so reasons read in order of what mattered.
  const scored = (Object.entries(rules.scored) as [GarmentMeasurementKey, MeasurementRule][]).sort(
    ([, a], [, b]) => b.weight - a.weight,
  );
  const totalWeight = scored.reduce((sum, [, rule]) => sum + rule.weight, 0);

  if (sizeChart.length === 0) return { status: 'no_size_data', reason: 'no_chart' };

  const required = scored.filter(([, rule]) => rule.required);
  const chartIncomplete = required.some(([key]) =>
    sizeChart.some((row) => typeof row.measurements[key] !== 'number'),
  );
  if (chartIncomplete) return { status: 'no_size_data', reason: 'chart_incomplete' };

  const missing = required
    .filter(([key]) => bodyValue(profile, key) === null)
    .map(([key]) => profileMeasurementKey(key));
  if (missing.length > 0) return { status: 'insufficient_data', missing };

  const sizes: ScoredSize[] = sizeChart.map((row, index) => {
    const comparisons: ScoredComparison[] = [];
    for (const [key, rule] of scored) {
      const garment = row.measurements[key];
      const body = bodyValue(profile, key);
      if (typeof garment !== 'number' || body === null) continue;
      comparisons.push(compare(rule, key, garment, body, fit));
    }
    const weight = comparisons.reduce((sum, c) => sum + c.rule.weight, 0);
    const weighted = comparisons.reduce((sum, c) => sum + c.rule.weight * c.score, 0);
    return {
      index,
      sizeId: row.sizeId,
      score: weight > 0 ? weighted / weight : 0,
      coverage: totalWeight > 0 ? weight / totalWeight : 0,
      comparisons,
    };
  });

  const preferSmaller = TIE_BREAK[fit] === 'smaller';
  let best = sizes[0]!;
  for (const size of sizes.slice(1)) {
    const better = size.score - best.score > SCORING.TIE_EPSILON;
    const tied = Math.abs(size.score - best.score) <= SCORING.TIE_EPSILON;
    // Sizes are visited smallest first: on a tie a later one is larger.
    if (better || (tied && !preferSmaller)) best = size;
  }

  const requiredComparisons = best.comparisons.filter((c) => c.rule.required);
  if (best.score === 0 || requiredComparisons.some((c) => TOO_FAR.has(c.fit))) {
    const signs = requiredComparisons.map((c) => Math.sign(c.n));
    const direction = signs.every((s) => s < 0)
      ? 'above'
      : signs.every((s) => s > 0)
        ? 'below'
        : 'mixed';
    return { status: 'no_matching_size', direction, fitPreference: fit };
  }

  const runnerUp = sizes
    .filter((size) => size.index !== best.index)
    .reduce<ScoredSize | null>((top, size) => (!top || size.score > top.score ? size : top), null);
  const betweenSizes = runnerUp !== null && best.score - runnerUp.score <= CONFIDENCE.CLEAR_MARGIN;

  let confidence: SizeConfidence = 'LOW';
  if (
    best.score >= CONFIDENCE.HIGH_MIN_SCORE &&
    requiredComparisons.every((c) => c.fit === 'fits') &&
    best.coverage >= CONFIDENCE.HIGH_MIN_COVERAGE &&
    !betweenSizes
  ) {
    confidence = 'HIGH';
  } else if (best.score >= CONFIDENCE.MEDIUM_MIN_SCORE) {
    confidence = 'MEDIUM';
  }

  const reasons: SizeRecommendationReason[] = best.comparisons.map((c) => ({
    code: 'measurement',
    measurement: c.measurement,
    fit: c.fit,
  }));
  if (best.comparisons.some((c) => c.measurement === 'lengthCm')) {
    reasons.push({ code: 'length_from_height' });
  }
  reasons.push({ code: 'fit_preference', fitPreference: fit });
  if (betweenSizes && runnerUp)
    reasons.push({ code: 'between_sizes', otherSizeId: runnerUp.sizeId });
  if (best.coverage < LIMITED_COVERAGE_BELOW) {
    const unmeasured = scored
      .filter(([key]) => bodyValue(profile, key) === null)
      .map(([key]) => profileMeasurementKey(key));
    if (unmeasured.length > 0) reasons.push({ code: 'limited_measurements', missing: unmeasured });
  }

  const alternatives: SizeAlternative[] = [];
  for (const [offset, direction] of [
    [-1, 'smaller'],
    [1, 'larger'],
  ] as const) {
    const neighbour = sizes[best.index + offset];
    if (neighbour && neighbour.score >= ALTERNATIVE_MIN_SCORE) {
      alternatives.push({ sizeId: neighbour.sizeId, direction, score: percent(neighbour.score) });
    }
  }
  alternatives.sort((a, b) => b.score - a.score);

  const sizeFits: SizeFit[] = sizes.map((size) => ({
    sizeId: size.sizeId,
    score: percent(size.score),
    comparisons: size.comparisons.map(({ measurement, fit: f }) => ({ measurement, fit: f })),
  }));

  return {
    status: 'recommended',
    recommendation: {
      recommendedSizeId: best.sizeId,
      confidence,
      score: percent(best.score),
      fitPreference: fit,
      reasons,
      alternatives,
      sizes: sizeFits,
    },
  };
}

function percent(score: number): number {
  return Math.round(score * 100);
}

/** The service the storefront uses. Rule-based, so `recommend` is the pure
 * engine above; it is async only because the contract allows a future
 * implementation that is not. */
export class RuleBasedSizeRecommendationService implements SizeRecommendationService {
  async recommend(request: SizeRecommendationRequest): Promise<SizeRecommendationResult> {
    return recommendSize(request);
  }
}

export const sizeRecommendationService: SizeRecommendationService =
  new RuleBasedSizeRecommendationService();
