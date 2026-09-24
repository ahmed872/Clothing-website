/**
 * Where media bytes are served from, derived from configuration alone.
 *
 * Two places need this answer and they must never disagree (P14):
 *
 *   1. `getPublicUrl` on each provider, which builds the `src` an `<Image>`
 *      actually points at;
 *   2. `next.config.ts`'s `images.remotePatterns`, which is Next's allowlist
 *      of hosts `next/image` is willing to optimize.
 *
 * Before P14 only the first derived the S3 fallbacks. `remotePatterns`
 * listed `MEDIA_PUBLIC_BASE_URL` and `NEXT_PUBLIC_SITE_URL` and nothing
 * else — so `STORAGE_PROVIDER="s3"` *without* a CDN base (the ordinary way
 * to start: a bucket, no CDN in front of it yet) produced image URLs on the
 * bucket's own host, which `next/image` then refused, and every product
 * photo in the store failed to render. A configuration this codebase
 * explicitly supports, breaking on a rule written somewhere else.
 *
 * Deliberately pure: no `server-only`, no `serverEnv()`, no imports at all.
 * `next.config.ts` is evaluated before the application's module graph
 * exists and reads `process.env` directly for that reason; a function with
 * no dependencies is safe to call from both sides, which is the whole point
 * of putting it here rather than duplicating the precedence rules.
 */

/** Just the fields that decide a media URL's origin. Loosely typed on
 * purpose: `next.config.ts` passes raw `process.env`. */
export interface MediaOriginEnv {
  STORAGE_PROVIDER?: string | undefined;
  MEDIA_PUBLIC_BASE_URL?: string | undefined;
  STORAGE_ENDPOINT?: string | undefined;
  STORAGE_BUCKET?: string | undefined;
  STORAGE_REGION?: string | undefined;
  NEXT_PUBLIC_SITE_URL?: string | undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * The base URL media is served from — the exact precedence each provider's
 * `getPublicUrl` follows, in one place.
 *
 * Returns `null` only when nothing in the environment says where media
 * lives (the `local` provider with no site URL configured, which the env
 * schema already makes impossible for a real boot).
 */
export function mediaPublicBaseUrl(env: MediaOriginEnv): string | null {
  // A CDN in front of whichever backend holds the bytes. Wins for both
  // providers, which is why it is checked before the provider is.
  if (env.MEDIA_PUBLIC_BASE_URL) return trimTrailingSlash(env.MEDIA_PUBLIC_BASE_URL);

  if (env.STORAGE_PROVIDER === 's3') {
    // Any non-AWS S3-compatible endpoint (R2, MinIO, Wasabi, …). The bucket
    // is a path segment under it — `forcePathStyle` in `s3-provider.ts`.
    if (env.STORAGE_ENDPOINT && env.STORAGE_BUCKET) {
      return `${trimTrailingSlash(env.STORAGE_ENDPOINT)}/${env.STORAGE_BUCKET}`;
    }
    // Real AWS S3: virtual-hosted style, the bucket as a subdomain.
    if (env.STORAGE_BUCKET) {
      return `https://${env.STORAGE_BUCKET}.s3.${env.STORAGE_REGION ?? 'us-east-1'}.amazonaws.com`;
    }
    return null;
  }

  // `local`: bytes come back through this application's own route handler.
  return env.NEXT_PUBLIC_SITE_URL ? trimTrailingSlash(env.NEXT_PUBLIC_SITE_URL) : null;
}

/**
 * Every origin an `<Image>` `src` produced by this application can carry —
 * what `images.remotePatterns` has to allow.
 *
 * `images.unsplash.com` is not derived from configuration and is not
 * included here: it is P03/P04's fixed set of `EXTERNAL` `MediaAsset` rows
 * whose `storageKey` is still the original Unsplash URL, listed literally
 * in `next.config.ts` where it belongs.
 */
export function mediaPublicOrigins(env: MediaOriginEnv): string[] {
  const origins = new Set<string>();

  for (const candidate of [mediaPublicBaseUrl(env), env.NEXT_PUBLIC_SITE_URL]) {
    if (!candidate) continue;
    try {
      origins.add(new URL(candidate).origin);
    } catch {
      // Not an absolute URL — nothing to allow.
    }
  }

  return [...origins];
}
