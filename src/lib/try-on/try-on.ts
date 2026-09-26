import 'server-only';

import { clientEnv } from '@/modules/core';
import { getTryOnConfig, type TryOnContext, type TryOnSubject } from '@/modules/tryon';
import { loadFittingRoom } from '@/lib/fitting/fitting-room';

/**
 * The server side of optional AI try-on for the storefront (clothing P05):
 * whether it is on, and what a job for one variant is built from.
 *
 * A job is described entirely from server data. The browser names a product
 * (by slug) and one of its variants; the garment's type, size, colour and
 * image come from the catalog and its sizing, and the body from the signed-in
 * customer's own saved profile — the same loader the fitting room itself
 * uses, so try-on can only ever be asked for what the fitting room shows.
 */

export type TryOnAvailability = { enabled: false } | { enabled: true; isMock: boolean };

export function tryOnContext(): TryOnContext | null {
  const config = getTryOnConfig();
  return config ? { provider: config.provider, resultHosts: config.resultHosts } : null;
}

export function getTryOnAvailability(): TryOnAvailability {
  const config = getTryOnConfig();
  return config ? { enabled: true, isMock: config.provider.isMock } : { enabled: false };
}

/** Null when the product is not in the fitting room for this customer (not
 * published, no sizing, no profile) or the variant is not one of its own. */
export async function buildTryOnSubject(
  customerId: string,
  slug: string,
  variantId: string,
): Promise<TryOnSubject | null> {
  const data = await loadFittingRoom(customerId, slug, {});
  if (data.status !== 'ready') return null;

  const variant = data.variants.find((v) => v.id === variantId);
  if (!variant) return null;
  const size = data.results.find((r) => variant.optionValueIds.includes(r.size.sizeId));
  if (!size) return null;
  const color = data.colors.find((c) => variant.optionValueIds.includes(c.valueId)) ?? null;

  const m = data.profile.measurements;
  // A saved profile always has these three (they are required to save one).
  if (m.heightCm === null || m.weightKg === null || m.waistCm === null) return null;

  return {
    productId: data.product.id,
    variantId: variant.id,
    profileVersion: data.profile.updatedAt,
    garment: {
      productId: data.product.id,
      variantId: variant.id,
      garmentType: size.garmentType,
      name: data.product.name,
      sizeLabel: size.size.label,
      colorHex: color?.swatchHex ?? null,
      // A provider fetches it from outside, so a local path becomes absolute.
      imageUrl: data.product.imageUrl
        ? new URL(data.product.imageUrl, clientEnv().NEXT_PUBLIC_SITE_URL).toString()
        : null,
    },
    body: {
      gender: data.profile.gender,
      heightCm: m.heightCm,
      weightKg: m.weightKg,
      waistCm: m.waistCm,
      chestCm: m.chestCm,
      hipCm: m.hipCm,
      shoulderCm: m.shoulderCm,
      inseamCm: m.inseamCm,
    },
  };
}
