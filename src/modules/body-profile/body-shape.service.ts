import type { BodyShape } from '@generated/prisma';

/**
 * Derives a proportion description from the customer's own measurements.
 *
 * It is never asked for and never authoritative: the measurements are what
 * sizing reads, and this is a coarse summary of them for later
 * recommendations to use as a hint. It is stored (`BodyProfile.bodyShape`)
 * so it can be queried, and recomputed on every save, so improving the
 * rules below changes future saves without any change to the database
 * contract — bump `BODY_SHAPE_RULES_VERSION` when they change, so a later
 * backfill knows which rows were derived by the old rules.
 *
 * The labels name the proportion itself ("hips wider than chest") rather
 * than any fruit, letter or shape metaphor, and none of them ranks one body
 * above another.
 *
 * Rules (circumferences in cm; chest and hip are both needed — without
 * either there is nothing to compare, and the answer is `null`, not a
 * guess):
 *   1. waist ≥ both chest and hip            → WAIST_WIDEST
 *   2. hip exceeds chest by ≥ 5% of the smaller → HIPS_WIDER
 *   3. chest exceeds hip by ≥ 5% of the smaller → CHEST_WIDER
 *   4. chest ≈ hip, waist ≤ 75% of their mean  → DEFINED_WAIST
 *   5. otherwise                               → STRAIGHT
 */

export const BODY_SHAPE_RULES_VERSION = 1;

const SIDE_DIFFERENCE = 0.05;
const DEFINED_WAIST_RATIO = 0.75;

export interface BodyShapeMeasurements {
  chestCm: number | null;
  waistCm: number | null;
  hipCm: number | null;
}

export function deriveBodyShape({
  chestCm,
  waistCm,
  hipCm,
}: BodyShapeMeasurements): BodyShape | null {
  if (chestCm === null || waistCm === null || hipCm === null) return null;
  if (chestCm <= 0 || waistCm <= 0 || hipCm <= 0) return null;

  if (waistCm >= chestCm && waistCm >= hipCm) return 'WAIST_WIDEST';

  const sideDifference = (hipCm - chestCm) / Math.min(chestCm, hipCm);
  if (sideDifference >= SIDE_DIFFERENCE) return 'HIPS_WIDER';
  if (sideDifference <= -SIDE_DIFFERENCE) return 'CHEST_WIDER';

  const waistRatio = waistCm / ((chestCm + hipCm) / 2);
  return waistRatio <= DEFINED_WAIST_RATIO ? 'DEFINED_WAIST' : 'STRAIGHT';
}
