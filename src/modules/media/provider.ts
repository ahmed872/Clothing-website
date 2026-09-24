/**
 * The one interface every storage backend implements. `media-asset.service.ts`
 * and every other caller in this module talk to `StorageProvider`, never to
 * `S3StorageProvider` or `LocalStorageProvider` directly — swapping the
 * backend (a new region, a different S3-compatible vendor, local → S3 in
 * production) never touches `catalog`, `content`, or any other consumer.
 */

/** Formats this platform accepts, full stop — checked against the *actual*
 * decoded bytes (`validation.ts`), never the client's claimed content-type. */
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MiB
export const UPLOAD_URL_TTL_SECONDS = 5 * 60;

export interface SignedUpload {
  method: 'PUT';
  /** Where the client sends the bytes — a real S3 presigned URL, or (local
   * provider) an app route that enforces the same signature contract. */
  url: string;
  headers: Record<string, string>;
  /** The storage key the file will exist at once the upload succeeds. Always
   * server-generated (see `media-asset.service.ts#requestUpload`) — never
   * accepted from a caller, which is what makes "storage key manipulation"
   * structurally impossible rather than merely validated against. */
  key: string;
  expiresAt: Date;
}

export interface CreateSignedUploadInput {
  key: string;
  contentType: AllowedImageMimeType;
  maxSizeBytes: number;
}

export interface StoredObjectHead {
  sizeBytes: number;
  contentType: string;
}

export interface StorageProvider {
  readonly name: 'S3' | 'LOCAL';

  createSignedUpload(input: CreateSignedUploadInput): Promise<SignedUpload>;

  /** The real, server-verified size/content-type of whatever is actually at
   * `key` right now — `null` if nothing is there. Never derived from what a
   * client claimed. */
  headObject(key: string): Promise<StoredObjectHead | null>;

  getObjectBuffer(key: string): Promise<Buffer>;

  /** A direct, server-side write — used by the media migration script
   * (external URL → validated bytes → storage) and by tests, not by the
   * client upload path (which writes via the signed URL instead). */
  putObjectBuffer(key: string, body: Buffer, contentType: string): Promise<void>;

  deleteObject(key: string): Promise<void>;

  /** The URL this platform serves the asset from — a CDN domain fronting the
   * bucket in production. Callers never construct a provider URL themselves. */
  getPublicUrl(key: string): string;
}
