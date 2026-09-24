/**
 * `media` — assets, uploads, storage providers. Generic: products, banners
 * and content all use it.
 *
 * May depend on: core
 * Must not depend on: catalog, content — media is a service they consume
 *
 * P04: full implementation — S3-compatible + local storage providers behind
 * one `StorageProvider` interface, signed direct upload, server-side content
 * verification (never trust extension, content-type, or size from a
 * client), MediaAsset lifecycle, orphan detection.
 *
 * Other modules import `@/modules/media`, never a file inside it.
 */

export {
  requestUpload,
  confirmUpload,
  updateAltText,
  getMediaAsset,
  isMediaAssetReferenced,
  deleteMediaAsset,
  findOrphanMediaAssets,
} from './media-asset.service';

export { getMediaPublicUrl, toImageProp, type ResolvedMediaImage } from './cdn';

export { getStorageProvider } from './provider-factory';

/** Local-provider only — the `/api/media/local-upload/[key]` route handler's
 * implementation. Irrelevant (and never called) when STORAGE_PROVIDER=s3. */
export { handleLocalUploadPut } from './local-provider';

export {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  UPLOAD_URL_TTL_SECONDS,
  type AllowedImageMimeType,
  type StorageProvider,
  type SignedUpload,
} from './provider';

export {
  uploadContextSchema,
  requestUploadInputSchema,
  confirmUploadInputSchema,
  updateAltTextInputSchema,
  type UploadContext,
  type RequestUploadInput,
  type ConfirmUploadInput,
  type UpdateAltTextInput,
} from './schemas';
