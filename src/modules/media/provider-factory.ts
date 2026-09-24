import { serverEnv } from '@/modules/core';

import { localStorageProvider } from './local-provider';
import { s3StorageProvider } from './s3-provider';
import type { StorageProvider } from './provider';

let cached: StorageProvider | undefined;

/**
 * The single place `STORAGE_PROVIDER` is read to pick a backend. Every other
 * file in `media` (and every consumer outside it) works against
 * `StorageProvider`, never `if (provider === 's3')` — that branch exists
 * exactly once, here.
 */
export function getStorageProvider(): StorageProvider {
  if (cached) return cached;
  cached = serverEnv().STORAGE_PROVIDER === 's3' ? s3StorageProvider : localStorageProvider;
  return cached;
}

/** Test-only: forces the next `getStorageProvider()` call to re-read the
 * environment, for tests that toggle `STORAGE_PROVIDER` mid-suite. */
export function resetStorageProviderCache(): void {
  cached = undefined;
}
