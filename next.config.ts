import type { NextConfig } from 'next';

import { mediaPublicOrigins } from './src/modules/media/public-origins';

/**
 * `next/image` refuses to optimize any host it hasn't been told about —
 * every absolute-URL origin a real `<Image>` `src` can point to has to be
 * listed here. That includes the app's *own* origin: `remotePatterns` is
 * matched against the URL, not against "is this cross-origin", so an
 * absolute `${NEXT_PUBLIC_SITE_URL}/...` src is refused exactly like a
 * third-party one would be. Read directly from `process.env` (not the
 * validated `serverEnv()`/`clientEnv()` parsers) because this file runs
 * before the app's module graph exists.
 *
 * The origins themselves come from `media/public-origins.ts` — the same
 * function each storage provider's `getPublicUrl` derives its base from, so
 * the allowlist and the URLs cannot drift apart. They had drifted (P14):
 * this list previously named `MEDIA_PUBLIC_BASE_URL` and
 * `NEXT_PUBLIC_SITE_URL` only, so `STORAGE_PROVIDER="s3"` with no CDN in
 * front of the bucket — a supported, ordinary starting configuration —
 * served every image from the bucket's own host and `next/image` refused
 * all of them. That module is deliberately dependency-free so importing it
 * here pulls in nothing else.
 *
 * `images.unsplash.com` is the one host that is not derived from
 * configuration, so it stays written out here: P03/P04's known, documented
 * case, the 15 migrated-catalog MediaAssets that P04's migration script
 * couldn't download in this sandbox (network egress blocked) and which are
 * still `EXTERNAL` rows whose `storageKey` is the original Unsplash URL —
 * see `media/cdn.ts`. Nothing else should add a host here by convention.
 */
function remotePatterns(): NonNullable<NonNullable<NextConfig['images']>['remotePatterns']> {
  const patterns: NonNullable<NonNullable<NextConfig['images']>['remotePatterns']> = [
    { protocol: 'https', hostname: 'images.unsplash.com' },
  ];
  // Named explicitly rather than handing over all of `process.env`: this is
  // the whole set of variables this config file reads, and saying so keeps
  // it checkable against `MediaOriginEnv` instead of assignable to it by
  // accident.
  const origins = mediaPublicOrigins({
    STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
    MEDIA_PUBLIC_BASE_URL: process.env.MEDIA_PUBLIC_BASE_URL,
    STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT,
    STORAGE_BUCKET: process.env.STORAGE_BUCKET,
    STORAGE_REGION: process.env.STORAGE_REGION,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });
  for (const origin of origins) {
    const url = new URL(origin);
    patterns.push({
      protocol: url.protocol.replace(':', '') as 'http' | 'https',
      hostname: url.hostname,
      ...(url.port ? { port: url.port } : {}),
    });
  }
  return patterns;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: { remotePatterns: remotePatterns() },
  // The Playwright suite (P02) drives the dev server via 127.0.0.1 rather
  // than localhost; without this, Next's dev-origin check silently drops the
  // HMR/RSC websocket for that host, and components stop responding to
  // interaction (a click that never opens its dialog, with no console error).
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // Fail the production build on type errors instead of shipping them.
  // Next 16 no longer runs ESLint during `next build`; linting is its own CI
  // step (`pnpm lint`) so it gates the same way without slowing the build.
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
