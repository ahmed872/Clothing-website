import 'server-only';

import {
  getBodyProfile,
  serializeBodyProfile,
  toSizingProfile,
  type BodyProfileSnapshot,
} from '@/modules/body-profile';
import { getProductDetailBySlug } from '@/modules/catalog';
import { virtualFittingService, type FittingColor, type FittingResult } from '@/modules/fitting';
import {
  getProductSizing,
  getStorefrontSizeChart,
  resolveGarmentStyle,
  type FitPreference,
} from '@/modules/sizing';
import type { EffectivePrice } from '@/modules/catalog';

/**
 * Everything the fitting room page shows (clothing P04), assembled on the
 * server for the signed-in customer: the product from the catalog, its chart
 * and style from sizing, the customer's own profile, and every size of the
 * garment fitted on it by the fitting service.
 *
 * What it trusts from the URL: the product slug, and a colour and a size to
 * start on — each checked to be one of *this* product's option values, and
 * ignored otherwise. The customer is the caller's session, passed in; the
 * prices and stock come from the catalog, never from the request.
 */

export interface FittingVariant {
  id: string;
  optionValueIds: string[];
  price: EffectivePrice;
  stockStatus: 'in-stock' | 'low-stock' | 'out-of-stock';
}

export type FittingRoomData =
  | { status: 'not_found' }
  | { status: 'not_available'; product: FittingProductSummary }
  | { status: 'no_profile'; product: FittingProductSummary }
  | {
      status: 'ready';
      product: FittingProductSummary;
      profile: BodyProfileSnapshot;
      colors: FittingColor[];
      /** One per size, smallest first, in the starting colour. */
      results: FittingResult[];
      variants: FittingVariant[];
      sizeOptionId: string;
      colorOptionId: string | null;
      initial: { colorId: string | null; sizeId: string };
    };

export interface FittingProductSummary {
  id: string;
  slug: string;
  name: { ar: string; en: string };
  /** The catalog's own `fit` attribute, as the shopper reads it. */
  fit: { ar: string; en: string } | null;
  /** The first product image's public URL (clothing P05: sent to an AI
   * try-on provider, when one is configured). */
  imageUrl: string | null;
}

export async function loadFittingRoom(
  customerId: string,
  slug: string,
  query: { color?: string | null; size?: string | null; fit?: FitPreference },
): Promise<FittingRoomData> {
  const product = await getProductDetailBySlug(slug);
  if (!product) return { status: 'not_found' };

  const fitSpec = product.specifications.find((spec) => spec.key === 'fit');
  const fitValue = typeof fitSpec?.value === 'string' ? fitSpec.value : null;
  const summary: FittingProductSummary = {
    id: product.id,
    slug: product.slug,
    name: { ar: product.nameAr, en: product.nameEn },
    fit: fitValue ? { ar: fitSpec?.valueLabels[fitValue]?.ar ?? fitValue, en: fitValue } : null,
    imageUrl: product.images[0]?.src ?? null,
  };

  const [sizing, chart] = await Promise.all([
    getProductSizing(product.id),
    getStorefrontSizeChart(product.id),
  ]);
  if (!sizing || !chart || !sizing.sizeOption) return { status: 'not_available', product: summary };

  const profile = await getBodyProfile(customerId);
  if (!profile) return { status: 'no_profile', product: summary };

  const colorOption = sizing.colorOption
    ? product.options.find((option) => option.id === sizing.colorOption!.id)
    : undefined;
  const colors: FittingColor[] = (colorOption?.values ?? []).map((value) => ({
    valueId: value.id,
    label: { ar: value.valueAr, en: value.valueEn },
    swatchHex: sizing.swatches[value.id] ?? null,
  }));

  const defaultVariant = product.variants.find((v) => v.id === product.defaultVariantId);
  const startColor =
    colors.find((c) => c.valueId === query.color) ??
    colors.find((c) => defaultVariant?.optionValueIds.includes(c.valueId)) ??
    colors[0] ??
    null;

  const style = resolveGarmentStyle(sizing.garmentType, sizing.style);
  const results = virtualFittingService.fitAllSizes({
    profile: toSizingProfile(profile),
    product: { productId: product.id, garmentType: sizing.garmentType, style, chart: chart.rows },
    color: startColor,
    fitPreference: query.fit,
  });

  const chartIds = new Set(chart.rows.map((row) => row.sizeId));
  const recommended =
    results[0]?.recommendation.status === 'recommended' ? results[0].recommendation.sizeId : null;
  const fromDefault = defaultVariant?.optionValueIds.find((id) => chartIds.has(id));
  const startSize =
    (query.size && chartIds.has(query.size) ? query.size : null) ??
    recommended ??
    fromDefault ??
    chart.rows[0]!.sizeId;

  return {
    status: 'ready',
    product: summary,
    profile: serializeBodyProfile(profile),
    colors,
    results,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      optionValueIds: variant.optionValueIds,
      price: variant.price,
      stockStatus: variant.stockStatus,
    })),
    sizeOptionId: sizing.sizeOption.id,
    colorOptionId: colorOption?.id ?? null,
    initial: { colorId: startColor?.valueId ?? null, sizeId: startSize },
  };
}
