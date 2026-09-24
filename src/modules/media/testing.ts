import { rm } from 'node:fs/promises';
import path from 'node:path';

import { db, serverEnv } from '@/modules/core';

import { resetStorageProviderCache } from './provider-factory';

/**
 * Test-only: wipes MediaAsset rows and the local storage directory. Not
 * exported from `./index` — reachable only via the deep import the
 * `**\/*.test.ts` ESLint override exists for. Safe against the S3 provider
 * too (never touches a bucket): it only ever removes
 * `MEDIA_LOCAL_STORAGE_DIR` on disk, which is meaningless (and untouched) if
 * `STORAGE_PROVIDER=s3`.
 */
export async function resetMediaTables(): Promise<void> {
  await db.mediaAsset.deleteMany();
  resetStorageProviderCache();
  const dir = path.resolve(process.cwd(), serverEnv().MEDIA_LOCAL_STORAGE_DIR);
  await rm(dir, { recursive: true, force: true });
}
