import type { SizingProfile } from '@/modules/body-profile';
import {
  GARMENT_LAYER_KIND,
  recommendSize,
  type FitPreference,
  type GarmentLayerKind,
  type GarmentStyle,
  type GarmentType,
  type MeasurementComparison,
  type ProfileMeasurementKey,
  type SizeChartMeasurements,
  type SizeChartRow,
  type SizeConfidence,
} from '@/modules/sizing';

/**
 * The virtual fitting room's domain service (clothing P04): one garment, in
 * one colour and one size, on one customer's measurements — as structured
 * data a renderer can draw and a page can explain. Pure and deterministic:
 * no clock, no I/O, no randomness; the size engine is P02's, unchanged.
 *
 * It never decides for the customer. The recommended size is information;
 * the size shown is always the one they chose, with how it relates to the
 * recommendation ("one size smaller") and how it would sit, area by area.
 */

export interface FittingColor {
  valueId: string;
  label: { ar: string; en: string };
  /** `#RRGGBB` set by the admin, or null — drawn in a neutral tone. */
  swatchHex: string | null;
}

export interface FittingProduct {
  productId: string;
  garmentType: GarmentType;
  style: GarmentStyle;
  /** Smallest first — the product's own size option values. */
  chart: readonly SizeChartRow[];
}

export interface FittingInput {
  profile: SizingProfile;
  product: FittingProduct;
  sizeId: string;
  color: FittingColor | null;
  /** A fit to try; defaults to the profile's saved preference. */
  fitPreference?: FitPreference;
}

export type FittingRecommendation =
  | {
      status: 'recommended';
      sizeId: string;
      confidence: SizeConfidence;
      score: number;
      fitPreference: FitPreference;
    }
  | { status: 'insufficient_data'; missing: readonly ProfileMeasurementKey[] }
  | {
      status: 'no_matching_size';
      direction: 'above' | 'below' | 'mixed';
      fitPreference: FitPreference;
    }
  | { status: 'no_size_data' };

/** Where the chosen size stands against the recommendation. */
export type SizeRelation =
  { kind: 'recommended' } | { kind: 'smaller' | 'larger'; steps: number } | { kind: 'unknown' };

export interface FittingResult {
  garmentType: GarmentType;
  layerKind: GarmentLayerKind;
  style: GarmentStyle;
  color: FittingColor | null;
  size: {
    sizeId: string;
    label: { ar: string; en: string };
    /** Position in the chart, smallest first. */
    index: number;
    /** The garment's own measurements in this size (public chart data). */
    measurements: SizeChartMeasurements;
  };
  recommendation: FittingRecommendation;
  relation: SizeRelation;
  /** How this size sits: its 0–100 score and each compared area, or null
   * when the engine could not compare (missing data). */
  fit: { score: number; areas: readonly MeasurementComparison[] } | null;
}

export interface VirtualFittingService {
  /** Every size of the garment, smallest first, in the given colour — so a
   * fitting room can switch sizes without asking again. */
  fitAllSizes(input: Omit<FittingInput, 'sizeId'>): FittingResult[];
  fit(input: FittingInput): FittingResult;
}

function recommendationOf(input: Omit<FittingInput, 'sizeId'>) {
  const result = recommendSize({
    profile: input.profile,
    garmentType: input.product.garmentType,
    sizeChart: input.product.chart,
    fitPreference: input.fitPreference,
  });
  let recommendation: FittingRecommendation;
  switch (result.status) {
    case 'recommended':
      recommendation = {
        status: 'recommended',
        sizeId: result.recommendation.recommendedSizeId,
        confidence: result.recommendation.confidence,
        score: result.recommendation.score,
        fitPreference: result.recommendation.fitPreference,
      };
      break;
    case 'insufficient_data':
      recommendation = { status: 'insufficient_data', missing: result.missing };
      break;
    case 'no_matching_size':
      recommendation = {
        status: 'no_matching_size',
        direction: result.direction,
        fitPreference: result.fitPreference,
      };
      break;
    default:
      recommendation = { status: 'no_size_data' };
  }
  const sizes = result.status === 'recommended' ? result.recommendation.sizes : null;
  return { recommendation, sizes };
}

function relationTo(
  recommendation: FittingRecommendation,
  chart: readonly SizeChartRow[],
  index: number,
): SizeRelation {
  if (recommendation.status !== 'recommended') return { kind: 'unknown' };
  const recommendedIndex = chart.findIndex((row) => row.sizeId === recommendation.sizeId);
  if (recommendedIndex < 0 || index < 0) return { kind: 'unknown' };
  const steps = index - recommendedIndex;
  if (steps === 0) return { kind: 'recommended' };
  return { kind: steps < 0 ? 'smaller' : 'larger', steps: Math.abs(steps) };
}

export class LocalVirtualFittingService implements VirtualFittingService {
  fitAllSizes(input: Omit<FittingInput, 'sizeId'>): FittingResult[] {
    const { product } = input;
    const { recommendation, sizes } = recommendationOf(input);
    return product.chart.map((row, index) => {
      const scored = sizes?.find((size) => size.sizeId === row.sizeId);
      return {
        garmentType: product.garmentType,
        layerKind: GARMENT_LAYER_KIND[product.garmentType],
        style: product.style,
        color: input.color,
        size: { sizeId: row.sizeId, label: row.label, index, measurements: row.measurements },
        recommendation,
        relation: relationTo(recommendation, product.chart, index),
        fit: scored ? { score: scored.score, areas: scored.comparisons } : null,
      };
    });
  }

  fit(input: FittingInput): FittingResult {
    const all = this.fitAllSizes(input);
    const chosen = all.find((result) => result.size.sizeId === input.sizeId);
    if (!chosen) {
      // Only a size of this product can be tried on; anything else is a
      // caller's mistake, not something to guess around.
      throw new RangeError('Not a size of this product');
    }
    return chosen;
  }
}

export const virtualFittingService: VirtualFittingService = new LocalVirtualFittingService();
