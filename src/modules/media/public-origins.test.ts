import { describe, expect, it } from 'vitest';

import { mediaPublicBaseUrl, mediaPublicOrigins, type MediaOriginEnv } from './public-origins';

/**
 * The contract between a media URL and the host `next/image` will optimize
 * (P14).
 *
 * These two answers are produced in different files — `getPublicUrl` on each
 * storage provider, and `images.remotePatterns` in `next.config.ts` — and
 * when they disagreed, `STORAGE_PROVIDER="s3"` with no CDN base served every
 * product photo from a host the image optimizer refused. Both now derive
 * from the functions below, and the last test here is what keeps that true:
 * for every supported configuration, the origin of the URL a provider hands
 * out must be one the allowlist contains.
 */

const S3_WITH_CDN: MediaOriginEnv = {
  STORAGE_PROVIDER: 's3',
  STORAGE_BUCKET: 'luxedrive-media',
  STORAGE_REGION: 'eu-central-1',
  MEDIA_PUBLIC_BASE_URL: 'https://cdn.example.com/media/',
  NEXT_PUBLIC_SITE_URL: 'https://shop.example.com',
};

const S3_COMPATIBLE_ENDPOINT: MediaOriginEnv = {
  STORAGE_PROVIDER: 's3',
  STORAGE_BUCKET: 'luxedrive-media',
  STORAGE_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com',
  NEXT_PUBLIC_SITE_URL: 'https://shop.example.com',
};

const AWS_S3_BARE: MediaOriginEnv = {
  STORAGE_PROVIDER: 's3',
  STORAGE_BUCKET: 'luxedrive-media',
  STORAGE_REGION: 'eu-central-1',
  NEXT_PUBLIC_SITE_URL: 'https://shop.example.com',
};

const AWS_S3_NO_REGION: MediaOriginEnv = {
  STORAGE_PROVIDER: 's3',
  STORAGE_BUCKET: 'luxedrive-media',
  NEXT_PUBLIC_SITE_URL: 'https://shop.example.com',
};

const LOCAL: MediaOriginEnv = {
  STORAGE_PROVIDER: 'local',
  NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3000',
};

const LOCAL_WITH_CDN: MediaOriginEnv = {
  STORAGE_PROVIDER: 'local',
  MEDIA_PUBLIC_BASE_URL: 'https://cdn.example.com',
  NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3000',
};

describe('mediaPublicBaseUrl', () => {
  it('prefers a CDN base over everything, for either provider', () => {
    expect(mediaPublicBaseUrl(S3_WITH_CDN)).toBe('https://cdn.example.com/media');
    expect(mediaPublicBaseUrl(LOCAL_WITH_CDN)).toBe('https://cdn.example.com');
  });

  it('puts the bucket under a custom S3-compatible endpoint (path style)', () => {
    expect(mediaPublicBaseUrl(S3_COMPATIBLE_ENDPOINT)).toBe(
      'https://abc123.r2.cloudflarestorage.com/luxedrive-media',
    );
  });

  it('falls back to AWS virtual-hosted style, defaulting the region', () => {
    expect(mediaPublicBaseUrl(AWS_S3_BARE)).toBe(
      'https://luxedrive-media.s3.eu-central-1.amazonaws.com',
    );
    expect(mediaPublicBaseUrl(AWS_S3_NO_REGION)).toBe(
      'https://luxedrive-media.s3.us-east-1.amazonaws.com',
    );
  });

  it('serves local media from the application itself', () => {
    expect(mediaPublicBaseUrl(LOCAL)).toBe('http://127.0.0.1:3000');
  });

  it('has no answer when nothing says where media lives', () => {
    expect(mediaPublicBaseUrl({})).toBeNull();
    expect(mediaPublicBaseUrl({ STORAGE_PROVIDER: 's3' })).toBeNull();
  });
});

describe('mediaPublicOrigins', () => {
  it('always includes the application itself — an absolute same-origin src still needs allowing', () => {
    expect(mediaPublicOrigins(S3_WITH_CDN)).toContain('https://shop.example.com');
    expect(mediaPublicOrigins(LOCAL)).toEqual(['http://127.0.0.1:3000']);
  });

  it('does not repeat an origin that is both the media base and the site', () => {
    expect(mediaPublicOrigins(LOCAL)).toHaveLength(1);
  });

  it('ignores a value that is not an absolute URL rather than throwing', () => {
    expect(mediaPublicOrigins({ MEDIA_PUBLIC_BASE_URL: '/media' })).toEqual([]);
  });

  /**
   * The regression that started all of this: every configuration's own
   * media URL has to be servable under that configuration's allowlist.
   * `${base}/${key}` is exactly how both providers build a URL, so
   * checking the base's origin checks the real thing.
   */
  it.each([
    ['s3 behind a CDN', S3_WITH_CDN],
    ['s3-compatible endpoint, no CDN', S3_COMPATIBLE_ENDPOINT],
    ['AWS S3, no CDN', AWS_S3_BARE],
    ['AWS S3, no CDN, no region', AWS_S3_NO_REGION],
    ['local', LOCAL],
    ['local behind a CDN', LOCAL_WITH_CDN],
  ])('%s: the URL a provider hands out is one next/image is allowed to load', (_name, env) => {
    const base = mediaPublicBaseUrl(env);
    expect(base).not.toBeNull();
    const url = new URL(`${base}/media/product/example.jpg`);
    expect(mediaPublicOrigins(env)).toContain(url.origin);
  });
});
