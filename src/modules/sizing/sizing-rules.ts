import type { FitPreference, GarmentMeasurementKey, GarmentType } from './garment-types';

/**
 * Every number the size engine uses, in one place (clothing P02).
 *
 * The engine (`size-engine.ts`) contains no sizing numbers of its own: it
 * reads this table. Tuning a garment's fit is an edit here and a test run,
 * never a change to the algorithm — and every value below says what it
 * means, so a recommendation can always be traced back to a rule.
 *
 * Units are centimetres throughout. "Ease" is the room a garment has over
 * the body at one point: garment measurement minus body measurement. The
 * values are common pattern-making allowances — a starting point chosen to
 * be defensible, not measured from any one brand — and they are the whole
 * of what a fit preference changes: SLIM aims for less room, RELAXED for
 * more. The customer's measurements are never adjusted.
 */

export const SIZING_RULES_VERSION = 1;

/** How one garment measurement is compared with the body. */
export interface MeasurementRule {
  /** How much this measurement counts towards a size's score, relative to
   * the garment's other measurements. */
  weight: number;
  /** Without this measurement — from the customer or from the chart — no
   * recommendation is made at all (`insufficient_data` / `no_size_data`). */
  required: boolean;
  /** The ideal ease, per fit preference. */
  ease: Record<FitPreference, number>;
  /** How far from the ideal ease (either way) still counts as a good fit. */
  tolerance: number;
}

export interface GarmentRules {
  /** The measurements that decide the size, most important first. */
  scored: Partial<Record<GarmentMeasurementKey, MeasurementRule>>;
  /** Measurements a chart may show for this garment (a T-shirt's length,
   * a dress's length) that are not compared with the body — informative
   * for the shopper, never part of the score. */
  chartOnly: readonly GarmentMeasurementKey[];
}

function rule(
  weight: number,
  required: boolean,
  [slim, regular, relaxed]: [number, number, number],
  tolerance: number,
): MeasurementRule {
  return { weight, required, ease: { SLIM: slim, REGULAR: regular, RELAXED: relaxed }, tolerance };
}

/**
 * Per garment type. Shoulder, sleeve, inseam and neck ease are small (a
 * seam sits where the body's landmark is); chest, waist and hip ease grow
 * with how loose the garment is meant to be. Length is compared only for
 * full-length garments (abaya, thobe), where it is the measurement a size
 * number actually names; everywhere else it is style, and shown only.
 */
export const GARMENT_RULES: Record<GarmentType, GarmentRules> = {
  T_SHIRT: {
    scored: {
      chestCm: rule(1, true, [6, 10, 18], 4),
      shoulderCm: rule(0.5, false, [0, 1, 3], 2),
    },
    chartOnly: ['lengthCm', 'sleeveCm'],
  },
  SHIRT: {
    scored: {
      chestCm: rule(1, true, [8, 12, 18], 4),
      shoulderCm: rule(0.6, false, [0, 1, 2], 2),
      neckCm: rule(0.4, false, [1, 1.5, 2.5], 1),
      sleeveCm: rule(0.4, false, [0, 1, 2], 3),
      waistCm: rule(0.3, false, [8, 14, 20], 6),
    },
    chartOnly: ['lengthCm'],
  },
  HOODIE: {
    scored: {
      chestCm: rule(1, true, [10, 16, 24], 5),
      shoulderCm: rule(0.4, false, [1, 2, 4], 3),
      sleeveCm: rule(0.3, false, [1, 2, 3], 3),
    },
    chartOnly: ['lengthCm'],
  },
  SWEATER: {
    scored: {
      chestCm: rule(1, true, [8, 12, 20], 5),
      shoulderCm: rule(0.4, false, [0, 2, 4], 3),
      sleeveCm: rule(0.3, false, [0, 1, 2], 3),
    },
    chartOnly: ['lengthCm'],
  },
  JACKET: {
    scored: {
      chestCm: rule(1, true, [10, 14, 20], 4),
      shoulderCm: rule(0.7, false, [0, 1, 3], 2),
      sleeveCm: rule(0.4, false, [0, 1, 2], 3),
    },
    chartOnly: ['lengthCm'],
  },
  CARDIGAN: {
    scored: {
      chestCm: rule(1, true, [8, 12, 20], 5),
      shoulderCm: rule(0.4, false, [0, 2, 4], 3),
      sleeveCm: rule(0.3, false, [0, 1, 2], 3),
    },
    chartOnly: ['lengthCm'],
  },
  DRESS: {
    scored: {
      waistCm: rule(1, true, [4, 8, 16], 4),
      chestCm: rule(0.9, false, [5, 8, 14], 4),
      hipCm: rule(0.8, false, [5, 8, 16], 5),
      shoulderCm: rule(0.3, false, [0, 1, 2], 2),
    },
    chartOnly: ['lengthCm'],
  },
  ABAYA: {
    scored: {
      lengthCm: rule(1, true, [0, 2, 4], 4),
      chestCm: rule(0.5, false, [14, 20, 28], 8),
      shoulderCm: rule(0.3, false, [0, 2, 4], 3),
    },
    chartOnly: ['sleeveCm'],
  },
  THOBE: {
    scored: {
      lengthCm: rule(1, true, [0, 0, 2], 4),
      chestCm: rule(0.8, false, [12, 16, 22], 5),
      shoulderCm: rule(0.4, false, [0, 1, 2], 2),
      sleeveCm: rule(0.3, false, [0, 1, 2], 3),
      neckCm: rule(0.3, false, [1, 1.5, 2.5], 1),
    },
    chartOnly: [],
  },
  JEANS: {
    scored: {
      waistCm: rule(1, true, [0, 2, 4], 2.5),
      hipCm: rule(0.7, false, [2, 4, 8], 4),
      inseamCm: rule(0.5, false, [0, 0, 1], 3),
    },
    chartOnly: ['lengthCm'],
  },
  TROUSERS: {
    scored: {
      waistCm: rule(1, true, [1, 3, 6], 3),
      hipCm: rule(0.7, false, [4, 8, 14], 5),
      inseamCm: rule(0.5, false, [0, 0, 1], 3),
    },
    chartOnly: ['lengthCm'],
  },
  SHORTS: {
    scored: {
      waistCm: rule(1, true, [1, 3, 6], 3),
      hipCm: rule(0.7, false, [4, 8, 14], 5),
    },
    chartOnly: ['inseamCm', 'lengthCm'],
  },
  SKIRT: {
    scored: {
      waistCm: rule(1, true, [0, 2, 4], 2.5),
      hipCm: rule(0.8, false, [4, 8, 14], 5),
    },
    chartOnly: ['lengthCm'],
  },
};

/**
 * Where each garment measurement's body counterpart comes from. Length has
 * no direct body measurement: for the full-length garments that score it,
 * the body length is estimated from height — shoulder to ankle is about
 * 80% of standing height in standard figure proportions (shoulder height
 * ≈ 0.82 H, ankle ≈ 0.02–0.04 H). The reason list tells the shopper when
 * this estimate was used.
 */
export const FULL_LENGTH_RATIO = 0.8;

/** The body-profile field each garment measurement is compared with. */
export const BODY_COUNTERPART = {
  chestCm: 'chestCm',
  waistCm: 'waistCm',
  hipCm: 'hipCm',
  shoulderCm: 'shoulderCm',
  sleeveCm: 'sleeveLengthCm',
  inseamCm: 'inseamCm',
  neckCm: 'neckCm',
  lengthCm: 'heightCm',
} as const satisfies Record<GarmentMeasurementKey, string>;
export type BodyCounterpart = (typeof BODY_COUNTERPART)[GarmentMeasurementKey];

/**
 * How a measurement's deviation becomes a score. With `n` the deviation
 * from the ideal ease in tolerances (`(garment − body − ease) / tolerance`):
 *   - `|n| ≤ 1` fits; `1 < |n| ≤ 2` is snug (too little room) or loose;
 *     beyond 2 it is too tight or too loose;
 *   - the measurement scores `1 − |n| / FALLOFF`, floored at 0 — so a
 *     perfect match is 1, the edge of "fits" is 0.67, and three tolerances
 *     out is 0;
 *   - room short of the ideal counts `TIGHT_PENALTY` times as much as the
 *     same room over it: a garment that is too small cannot be worn at all,
 *     one that is a little big can.
 * A size's score is the weighted mean of its measurements' scores.
 */
export const SCORING = {
  FITS_WITHIN: 1,
  CLOSE_WITHIN: 2,
  FALLOFF: 3,
  TIGHT_PENALTY: 1.25,
  /** Two sizes this close in score are a tie; see `TIE_BREAK`. */
  TIE_EPSILON: 0.005,
} as const;

/**
 * A tie goes to the larger size — a garment can be taken in, not let out —
 * unless the customer asked for a slim fit.
 */
export const TIE_BREAK: Record<FitPreference, 'smaller' | 'larger'> = {
  SLIM: 'smaller',
  REGULAR: 'larger',
  RELAXED: 'larger',
};

/**
 * Confidence is a rule-based classification, not a statistic — it says how
 * much of the decision rested on good evidence:
 *   - HIGH: score ≥ `HIGH_MIN_SCORE`, every required measurement fits, the
 *     customer and chart together covered at least `HIGH_MIN_COVERAGE` of
 *     the garment's measurement weight, and no other size scored within
 *     `CLEAR_MARGIN` (not between sizes);
 *   - MEDIUM: score ≥ `MEDIUM_MIN_SCORE`;
 *   - LOW: anything else that still produced a size.
 * `insufficient_data` is not a confidence level below LOW: it is the
 * absence of a recommendation.
 */
export const CONFIDENCE = {
  HIGH_MIN_SCORE: 0.75,
  HIGH_MIN_COVERAGE: 0.7,
  CLEAR_MARGIN: 0.05,
  MEDIUM_MIN_SCORE: 0.5,
} as const;

/** A neighbouring size is offered as an alternative when it scores at
 * least this — close enough to be a reasonable choice for someone who
 * prefers a closer or a looser fit. */
export const ALTERNATIVE_MIN_SCORE = 0.4;

/** Below this share of the garment's measurement weight, the reasons ask
 * for the optional measurements that would sharpen the result. */
export const LIMITED_COVERAGE_BELOW = CONFIDENCE.HIGH_MIN_COVERAGE;

/** The measurements a chart for this garment may hold, in chart order. */
export function chartMeasurementsFor(garmentType: GarmentType): GarmentMeasurementKey[] {
  const rules = GARMENT_RULES[garmentType];
  const keys = new Set<GarmentMeasurementKey>([
    ...(Object.keys(rules.scored) as GarmentMeasurementKey[]),
    ...rules.chartOnly,
  ]);
  const order: readonly GarmentMeasurementKey[] = [
    'chestCm',
    'waistCm',
    'hipCm',
    'shoulderCm',
    'sleeveCm',
    'inseamCm',
    'lengthCm',
    'neckCm',
  ];
  return order.filter((key) => keys.has(key));
}

/** The measurements every row of this garment's chart must have. */
export function requiredChartMeasurementsFor(garmentType: GarmentType): GarmentMeasurementKey[] {
  const scored = GARMENT_RULES[garmentType].scored;
  return (Object.keys(scored) as GarmentMeasurementKey[]).filter((key) => scored[key]!.required);
}
