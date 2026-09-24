import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { AppError, serverEnv } from '@/modules/core';

import { mediaPublicBaseUrl } from './public-origins';
import {
  UPLOAD_URL_TTL_SECONDS,
  type CreateSignedUploadInput,
  type SignedUpload,
  type StorageProvider,
  type StoredObjectHead,
} from './provider';

/**
 * Any S3-compatible bucket — real AWS S3, Cloudflare R2, MinIO, Wasabi, …
 * `STORAGE_ENDPOINT` is what makes it "S3-compatible" rather than
 * "AWS S3 specifically": omit it for real AWS, set it to point anywhere else
 * that speaks the S3 API. `forcePathStyle` follows the same rule almost every
 * non-AWS S3-compatible provider needs (virtual-hosted-style bucket
 * subdomains don't work against most of them).
 *
 * Not exercised against a live bucket in this environment — see the P04
 * report for what that means and what production credentials would prove
 * that this contract-level testing can't.
 */

let client: S3Client | undefined;

function getClient(): S3Client {
  if (client) return client;
  const env = serverEnv();
  client = new S3Client({
    region: env.STORAGE_REGION ?? 'auto',
    endpoint: env.STORAGE_ENDPOINT,
    forcePathStyle: Boolean(env.STORAGE_ENDPOINT),
    credentials:
      env.STORAGE_ACCESS_KEY_ID && env.STORAGE_SECRET_ACCESS_KEY
        ? { accessKeyId: env.STORAGE_ACCESS_KEY_ID, secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY }
        : undefined,
  });
  return client;
}

function bucket(): string {
  const value = serverEnv().STORAGE_BUCKET;
  if (!value) {
    // Defensive: `serverEnvSchema`'s superRefine already fails startup if
    // STORAGE_PROVIDER=s3 without a bucket, so this should be unreachable.
    throw new AppError('INTERNAL', { internalMessage: 'STORAGE_BUCKET is not configured' });
  }
  return value;
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  // @ts-expect-error — the SDK's Body type is a union of stream types across
  // runtimes; the async-iterable protocol is common to all of them in Node.
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export const s3StorageProvider: StorageProvider = {
  name: 'S3',

  async createSignedUpload(input: CreateSignedUploadInput): Promise<SignedUpload> {
    const command = new PutObjectCommand({
      Bucket: bucket(),
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.maxSizeBytes,
    });
    const url = await getSignedUrl(getClient(), command, { expiresIn: UPLOAD_URL_TTL_SECONDS });

    return {
      method: 'PUT',
      url,
      headers: { 'Content-Type': input.contentType },
      key: input.key,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000),
    };
  },

  async headObject(key: string): Promise<StoredObjectHead | null> {
    try {
      const result = await getClient().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
      return {
        sizeBytes: result.ContentLength ?? 0,
        contentType: result.ContentType ?? 'application/octet-stream',
      };
    } catch (error) {
      if (error instanceof NotFound) return null;
      throw error;
    }
  },

  async getObjectBuffer(key: string): Promise<Buffer> {
    const result = await getClient().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    return streamToBuffer(result.Body);
  },

  async putObjectBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
    await getClient().send(
      new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }),
    );
  },

  async deleteObject(key: string): Promise<void> {
    await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  },

  /** The precedence (CDN base → S3-compatible endpoint → AWS
   * virtual-hosted) lives in `public-origins.ts` rather than here, because
   * `next.config.ts`'s `images.remotePatterns` has to allow exactly the
   * origins this produces and the two silently disagreeing means every
   * product photo 400s (P14). */
  getPublicUrl(key: string): string {
    const env = serverEnv();
    const base = mediaPublicBaseUrl({
      STORAGE_PROVIDER: 's3',
      MEDIA_PUBLIC_BASE_URL: env.MEDIA_PUBLIC_BASE_URL,
      STORAGE_ENDPOINT: env.STORAGE_ENDPOINT,
      // Reuses `bucket()`'s own unreachable-by-construction guard rather
      // than inventing a second way to fail.
      STORAGE_BUCKET: bucket(),
      STORAGE_REGION: env.STORAGE_REGION,
    });
    if (!base) {
      throw new AppError('INTERNAL', { internalMessage: 'No public base URL for S3 media' });
    }
    return `${base}/${key}`;
  },
};
