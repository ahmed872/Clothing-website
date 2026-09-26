import 'server-only';

import { z } from 'zod';

import { FIT_PREFERENCES } from '@/modules/body-profile';
import {
  recommendSizeForCustomer,
  type FitPreference,
  type GarmentType,
  type ProfileMeasurementKey,
  type SizeAlternative,
  type SizeConfidence,
  type SizeFit,
  type SizeRecommendationReason,
} from '@/modules/sizing';
import { getOptionalCustomerAccount } from '@/lib/customers/customer-identity';

/**
 * The product page's size recommendation (clothing P02), as the product page
 * reads it through `GET /api/size-recommendation`.
 *
 * The product page is ISR — one cached HTML for every visitor — so anything
 * personal is fetched after it loads, for whoever the session says is
 * signed in. Through a Route Handler, not a Server Action: Next.js
 * dispatches a client's Server Actions one at a time, in the same queue as
 * its navigations, so a read on page load would hold up the shopper's next
 * click until it returned (the framework's own guidance: Route Handlers for
 * non-mutation requests).
 *
 * What it trusts from the browser: a product id (public, and only a
 * published product has a chart to read) and a fit preference to try (a
 * closed list; anything else is ignored). What it never accepts: a customer,
 * a profile, a size or a measurement. What it returns: sizes (the product's
 * own option value ids) and reason codes — never a body measurement, and
 * nothing at all about anyone but the caller.
 */

export type SizeRecommendationView =
  | { status: 'signed_out' }
  | { status: 'no_profile' }
  | { status: 'no_sizing' }
  | { status: 'insufficient_data'; garmentType: GarmentType; missing: ProfileMeasurementKey[] }
  | {
      status: 'no_matching_size';
      garmentType: GarmentType;
      fitPreference: FitPreference;
      direction: 'above' | 'below' | 'mixed';
    }
  | {
      status: 'recommended';
      garmentType: GarmentType;
      recommendedSizeId: string;
      confidence: SizeConfidence;
      score: number;
      fitPreference: FitPreference;
      reasons: SizeRecommendationReason[];
      alternatives: SizeAlternative[];
      sizes: SizeFit[];
    }
  | { status: 'error' };

const productIdSchema = z.uuid();
const fitSchema = z.enum(FIT_PREFERENCES);

export async function getSizeRecommendationView(
  productId: string,
  fitPreference?: string,
): Promise<SizeRecommendationView> {
  try {
    const id = productIdSchema.safeParse(productId);
    if (!id.success) return { status: 'no_sizing' };
    const fit = fitSchema.safeParse(fitPreference);

    const account = await getOptionalCustomerAccount();
    if (!account) return { status: 'signed_out' };

    const result = await recommendSizeForCustomer(account.customerId, id.data, {
      fitPreference: fit.success ? fit.data : undefined,
    });

    switch (result.status) {
      case 'no_profile':
      case 'no_sizing':
        return { status: result.status };
      // A chart that cannot size this garment is, for the shopper, no chart.
      case 'no_size_data':
        return { status: 'no_sizing' };
      case 'insufficient_data':
        return {
          status: 'insufficient_data',
          garmentType: result.garmentType,
          missing: [...result.missing],
        };
      case 'no_matching_size':
        return {
          status: 'no_matching_size',
          garmentType: result.garmentType,
          fitPreference: result.fitPreference,
          direction: result.direction,
        };
      case 'recommended': {
        const r = result.recommendation;
        return {
          status: 'recommended',
          garmentType: result.garmentType,
          recommendedSizeId: r.recommendedSizeId,
          confidence: r.confidence,
          score: r.score,
          fitPreference: r.fitPreference,
          reasons: [...r.reasons],
          alternatives: [...r.alternatives],
          sizes: r.sizes.map((size) => ({ ...size, comparisons: [...size.comparisons] })),
        };
      }
    }
  } catch (error) {
    // The code only — never the profile or the product's chart.
    console.error(
      'getSizeRecommendationView failed',
      (error as { code?: string })?.code ?? 'INTERNAL',
    );
    return { status: 'error' };
  }
}
