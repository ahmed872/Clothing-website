import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { AppError, serverEnv, clientEnv } from '@/modules/core';

import { mediaPublicBaseUrl } from './public-origins';
import { sign, verify } from './signing';
import type {
  AllowedImageMimeType,
  CreateSignedUploadInput,
  SignedUpload,
  StorageProvider,
  StoredObjectHead,
} from './provider';

/**
 * Dev/test storage: writes to local disk and emulates the *contract* of a
 * signed direct upload — a short-lived, tamper-evident URL that authorizes
 * exactly one key/content-type/size — using HMAC instead of AWS's request
 * signing. It does not emulate the *mechanics*: bytes still pass through
 * this app's own route handler (`/api/media/local-upload/[key]`), since
 * there is no real external object store to upload directly to. That one
 * difference — same authorization contract, different transport — is the
 * whole reason this is a `StorageProvider` implementation and not a mock:
 * every caller (`media-asset.service.ts`, the route handlers, the migration
 * script) goes through the exact same interface `S3StorageProvider` does.
 */

const EXTENSION_BY_MIME: Record<AllowedImageMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function extensionForMime(mime: AllowedImageMimeType): string {
  return EXTENSION_BY_MIME[mime];
}

// `turbopackIgnore`: the path is genuinely dynamic (env-configured), and
// without this Turbopack traces and bundles the entire project into the
// serverless function for this route. That tracing exists to catch a
// filesystem dependency a *production* deploy needs; this one is dev/test
// only by design (STORAGE_PROVIDER=local's whole point is "no cloud account
// needed yet") — production uses the S3 provider, which touches no local
// path at all, so there's nothing here worth tracing.
function storageRoot(): string {
  return path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    serverEnv().MEDIA_LOCAL_STORAGE_DIR,
  );
}

/** Resolves `key` under the storage root and refuses to leave it — the
 * defence-in-depth half of "no path traversal": keys are always
 * server-generated (see `media-asset.service.ts`), so this should never
 * actually trigger, but a resolver that can't be tricked into leaving its
 * root is cheap insurance against a future bug that generates one differently. */
function resolveSafePath(key: string): string {
  const root = storageRoot();
  const resolved = path.resolve(/* turbopackIgnore: true */ root, key);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new AppError('VALIDATION_FAILED', {
      internalMessage: `Storage key resolves outside the storage root: ${key}`,
    });
  }
  return resolved;
}

interface LocalUploadTokenPayload {
  key: string;
  contentType: string;
  maxSizeBytes: number;
  expiresAtMs: number;
}

function canonicalPayload(input: LocalUploadTokenPayload): string {
  return `${input.key}:${input.contentType}:${input.maxSizeBytes}:${input.expiresAtMs}`;
}

function signingSecret(): string {
  const secret = serverEnv().MEDIA_UPLOAD_SIGNING_SECRET;
  if (!secret) {
    // Reachable only if STORAGE_PROVIDER=local without the secret set, which
    // `serverEnvSchema`'s superRefine already fails startup on — this is a
    // second, defensive check, not the primary one.
    throw new AppError('INTERNAL', {
      internalMessage: 'MEDIA_UPLOAD_SIGNING_SECRET is not configured',
    });
  }
  return secret;
}

/** Verifies a local-upload token and, if valid, writes the body. Called by
 * the `/api/media/local-upload/[key]` route handler and directly by tests —
 * the same function either way, so a test genuinely exercises the
 * authorization logic rather than a stand-in for it. */
export async function handleLocalUploadPut(input: {
  key: string;
  contentType: string;
  maxSizeBytes: number;
  expiresAtMs: number;
  signature: string;
  body: Buffer;
}): Promise<void> {
  if (Date.now() > input.expiresAtMs) {
    throw new AppError('VALIDATION_FAILED', { details: { reason: 'Upload URL has expired' } });
  }
  const valid = verify(
    canonicalPayload({
      key: input.key,
      contentType: input.contentType,
      maxSizeBytes: input.maxSizeBytes,
      expiresAtMs: input.expiresAtMs,
    }),
    input.signature,
    signingSecret(),
  );
  if (!valid) {
    throw new AppError('VALIDATION_FAILED', {
      details: { reason: 'Invalid or tampered upload signature' },
    });
  }
  if (input.body.byteLength > input.maxSizeBytes) {
    throw new AppError('VALIDATION_FAILED', {
      details: { reason: `Upload exceeds the signed max size of ${input.maxSizeBytes} bytes` },
    });
  }

  const filePath = resolveSafePath(input.key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, input.body);
}

export const localStorageProvider: StorageProvider = {
  name: 'LOCAL',

  async createSignedUpload(input: CreateSignedUploadInput): Promise<SignedUpload> {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const payload: LocalUploadTokenPayload = {
      key: input.key,
      contentType: input.contentType,
      maxSizeBytes: input.maxSizeBytes,
      expiresAtMs: expiresAt.getTime(),
    };
    const signature = sign(canonicalPayload(payload), signingSecret());
    const params = new URLSearchParams({
      contentType: payload.contentType,
      maxSizeBytes: String(payload.maxSizeBytes),
      expiresAtMs: String(payload.expiresAtMs),
      signature,
    });

    return {
      method: 'PUT',
      url: `/api/media/local-upload/${encodeURIComponent(input.key)}?${params.toString()}`,
      headers: { 'Content-Type': input.contentType },
      key: input.key,
      expiresAt,
    };
  },

  async headObject(key: string): Promise<StoredObjectHead | null> {
    try {
      const stats = await stat(resolveSafePath(key));
      const ext = path.extname(key).slice(1).toLowerCase();
      return {
        sizeBytes: stats.size,
        contentType: MIME_BY_EXTENSION[ext] ?? 'application/octet-stream',
      };
    } catch {
      return null;
    }
  },

  async getObjectBuffer(key: string): Promise<Buffer> {
    return readFile(resolveSafePath(key));
  },

  async putObjectBuffer(key: string, body: Buffer): Promise<void> {
    const filePath = resolveSafePath(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
  },

  async deleteObject(key: string): Promise<void> {
    try {
      await unlink(resolveSafePath(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  },

  /** Same shared precedence the S3 provider uses (`public-origins.ts`), so
   * `next.config.ts`'s image allowlist and this URL can never drift apart
   * (P14) — plus this provider's own route prefix, which is the one part
   * that genuinely differs between the two backends. */
  getPublicUrl(key: string): string {
    const base = mediaPublicBaseUrl({
      STORAGE_PROVIDER: 'local',
      MEDIA_PUBLIC_BASE_URL: serverEnv().MEDIA_PUBLIC_BASE_URL,
      NEXT_PUBLIC_SITE_URL: clientEnv().NEXT_PUBLIC_SITE_URL,
    });
    return `${base ?? ''}/api/media/local-upload/${key}`;
  },
};
