import { getBodyProfile, toSizingProfile } from '@/modules/body-profile';

import type { FitPreference, GarmentType } from './garment-types';
import { getStorefrontSizeChart, type StorefrontSizeChart } from './size-chart.service';
import { sizeRecommendationService } from './size-engine';
import type { SizeRecommendationResult, SizeRecommendationService } from './size-recommendation';

/**
 * One customer's recommendation for one product (clothing P02): their own
 * profile, the product's published chart, and the rule-based engine.
 *
 * `customerId` is always the signed-in session's — the storefront action
 * takes it from `requireCustomer`-style resolution, never from the request —
 * and the result carries sizes and reason codes only, never a measurement.
 */

export type CustomerSizeRecommendation =
  | { status: 'no_profile' }
  | { status: 'no_sizing' }
  | (SizeRecommendationResult & { garmentType: GarmentType; chart: StorefrontSizeChart });

export interface RecommendForCustomerOptions {
  /** A fit to try instead of the saved one; never saved by this call. */
  fitPreference?: FitPreference;
  service?: SizeRecommendationService;
}

export async function recommendSizeForCustomer(
  customerId: string,
  productId: string,
  options: RecommendForCustomerOptions = {},
): Promise<CustomerSizeRecommendation> {
  const chart = await getStorefrontSizeChart(productId);
  if (!chart) return { status: 'no_sizing' };

  const profile = await getBodyProfile(customerId);
  if (!profile) return { status: 'no_profile' };

  const service = options.service ?? sizeRecommendationService;
  const result = await service.recommend({
    profile: toSizingProfile(profile),
    garmentType: chart.garmentType,
    sizeChart: chart.rows,
    fitPreference: options.fitPreference,
  });
  return { ...result, garmentType: chart.garmentType, chart };
}
