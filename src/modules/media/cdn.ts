import type { MediaAsset } from '@generated/prisma';

import { getStorageProvider } from './provider-factory';

/**
 * The one function anything outside `media` calls to get a displayable URL
 * for a `MediaAsset` — `catalog`, `content`, and every future consumer.
 * Nobody else constructs a provider URL, a CDN domain, or an S3 path by
 * hand, which is what makes changing `MEDIA_PUBLIC_BASE_URL` (or the
 * provider entirely) a one-file change instead of a grep-and-replace.
 *
 * Provider-aware, not just key-aware: a `MediaAsset` row's own `provider`
 * decides how its `storageKey` resolves, independently of whichever
 * provider `STORAGE_PROVIDER` currently configures for *new* uploads.
 * `EXTERNAL` is the one case that isn't "ask the configured provider" — it's
 * the transitional state from the P03 catalog migration (ADR-010/P04):
 * `storageKey` for those rows already *is* the full external URL, because
 * nothing has downloaded the bytes yet. Routing it through the configured
 * provider's `getPublicUrl` would silently build a nonsense address (e.g.
 * the local provider prefixing `/api/media/local-upload/` onto a full
 * `https://images.unsplash.com/...` URL). Returning it verbatim is correct
 * *and* temporary: P04's migration script flips these rows to a real
 * provider once it can reach the network, and this function needs no
 * change when that happens — the row's `provider` field is what changes.
 */
export function getMediaPublicUrl(asset: Pick<MediaAsset, 'provider' | 'storageKey'>): string {
  if (asset.provider === 'EXTERNAL') return asset.storageKey;
  return getStorageProvider().getPublicUrl(asset.storageKey);
}

export interface ResolvedMediaImage {
  src: string;
  alt: string;
  width: number | null;
  height: number | null;
}

/** Convenience for the common "I have a MediaAsset, I need an `<Image>`
 * prop bag" step — alt text falls back to the other locale's, then to an
 * empty string, so a missing translation never breaks rendering. */
export function toImageProp(
  asset: Pick<MediaAsset, 'provider' | 'storageKey' | 'altAr' | 'altEn' | 'width' | 'height'>,
  locale: 'ar' | 'en',
): ResolvedMediaImage {
  const alt = (locale === 'ar' ? asset.altAr : asset.altEn) ?? asset.altAr ?? asset.altEn ?? '';
  return { src: getMediaPublicUrl(asset), alt, width: asset.width, height: asset.height };
}
