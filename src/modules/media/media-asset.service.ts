import { randomUUID, createHash } from 'node:crypto';

import type { MediaAsset } from '@generated/prisma';

import { db, AppError } from '@/modules/core';

import { getStorageProvider } from './provider-factory';
import { extensionForMime } from './local-provider';
import { sniffImage, validateDeclaredUpload } from './validation';
import {
  requestUploadInputSchema,
  confirmUploadInputSchema,
  updateAltTextInputSchema,
  type RequestUploadInput,
  type ConfirmUploadInput,
  type UpdateAltTextInput,
} from './schemas';
import type { SignedUpload } from './provider';

/**
 * `MediaAsset` CRUD and its lifecycle: Uploaded (this file, on confirm) →
 * Attached (a `ProductImage`/`Category.imageMediaId`/`Brand.logoMediaId` row
 * references it — computed, not stored) → Detached (that reference is
 * removed) → Deleted (`deleteMediaAsset`, which refuses while any reference
 * exists). Attaching and detaching *to a product* is `catalog`'s job
 * (`product-image.service.ts`) — this file only ever knows "is this
 * referenced by something," never "by which product."
 */

export async function requestUpload(input: RequestUploadInput): Promise<SignedUpload> {
  const parsed = requestUploadInputSchema.parse(input);

  const declaredError = validateDeclaredUpload({
    contentType: parsed.contentType,
    sizeBytes: parsed.sizeBytes,
  });
  if (declaredError) {
    throw new AppError('VALIDATION_FAILED', { details: { reason: declaredError } });
  }

  // Server-generated, always — a client never supplies or influences the
  // key, which is what makes "storage key manipulation" not a category of
  // bug this service can have, rather than a case it happens to handle.
  const key = `media/${parsed.context}/${randomUUID()}.${extensionForMime(parsed.contentType)}`;

  return getStorageProvider().createSignedUpload({
    key,
    contentType: parsed.contentType,
    maxSizeBytes: parsed.sizeBytes,
  });
}

export async function confirmUpload(
  input: ConfirmUploadInput,
  altText: { altAr?: string | null; altEn?: string | null } = {},
): Promise<MediaAsset> {
  const parsed = confirmUploadInputSchema.parse(input);
  const provider = getStorageProvider();

  const head = await provider.headObject(parsed.key);
  if (!head) {
    throw new AppError('VALIDATION_FAILED', {
      details: { reason: 'Nothing was found at that key — upload it before confirming' },
    });
  }

  const buffer = await provider.getObjectBuffer(parsed.key);
  const sniffed = await sniffImage(buffer);
  if (!sniffed) {
    await provider.deleteObject(parsed.key);
    throw new AppError('VALIDATION_FAILED', {
      details: { reason: 'The uploaded file is not a valid JPEG, PNG, or WebP image' },
    });
  }

  const contentHash = createHash('sha256').update(buffer).digest('hex');

  const duplicate = await db.mediaAsset.findUnique({ where: { contentHash } });
  if (duplicate) {
    // Same bytes already exist as a different asset — reuse it rather than
    // storing (and tracking) a second identical copy (ADR: content-hash
    // dedup, the same rule the P04 media migration script applies).
    await provider.deleteObject(parsed.key);
    return duplicate;
  }

  return db.mediaAsset.create({
    data: {
      provider: provider.name,
      storageKey: parsed.key,
      contentHash,
      mime: sniffed.mime,
      sizeBytes: head.sizeBytes,
      width: sniffed.width,
      height: sniffed.height,
      altAr: altText.altAr,
      altEn: altText.altEn,
    },
  });
}

export async function updateAltText(id: string, input: UpdateAltTextInput): Promise<MediaAsset> {
  const parsed = updateAltTextInputSchema.parse(input);
  const asset = await getMediaAssetOrThrow(id);
  return db.mediaAsset.update({ where: { id: asset.id }, data: parsed });
}

export async function getMediaAsset(id: string): Promise<MediaAsset | null> {
  return db.mediaAsset.findUnique({ where: { id } });
}

async function getMediaAssetOrThrow(id: string): Promise<MediaAsset> {
  const asset = await getMediaAsset(id);
  if (!asset) throw new AppError('NOT_FOUND', { details: { entity: 'MediaAsset', id } });
  return asset;
}

interface ReferenceCounts {
  productImages: number;
  categories: number;
  brands: number;
}

async function countReferences(id: string): Promise<ReferenceCounts> {
  const [productImages, categories, brands] = await Promise.all([
    db.productImage.count({ where: { mediaId: id } }),
    db.category.count({ where: { imageMediaId: id } }),
    db.brand.count({ where: { logoMediaId: id } }),
  ]);
  return { productImages, categories, brands };
}

export async function isMediaAssetReferenced(id: string): Promise<boolean> {
  const counts = await countReferences(id);
  return counts.productImages + counts.categories + counts.brands > 0;
}

/**
 * Refuses while any reference exists — deleting a `Product`, or detaching
 * one image from it, must never take down a `MediaAsset` a *different*
 * product (or a category, or a brand) still uses. Deletes the stored object
 * before the database row, not after: a failed storage delete leaves the row
 * (and the object) intact and retryable; the reverse would leave a row
 * pointing at nothing.
 */
export async function deleteMediaAsset(id: string): Promise<void> {
  const asset = await getMediaAssetOrThrow(id);
  const counts = await countReferences(id);
  const total = counts.productImages + counts.categories + counts.brands;

  if (total > 0) {
    throw new AppError('CONFLICT', {
      details: { reason: 'MediaAsset is still referenced', ...counts },
    });
  }

  await getStorageProvider().deleteObject(asset.storageKey);
  await db.mediaAsset.delete({ where: { id } });
}

/** Detection only — this never deletes anything. Orphans are a normal,
 * expected state (an image detached from a product pending reuse or manual
 * cleanup, not an error), so this exists for a future cleanup job or admin
 * view to build on, not to act on automatically. */
export async function findOrphanMediaAssets(): Promise<MediaAsset[]> {
  return db.mediaAsset.findMany({
    where: {
      productImages: { none: {} },
      categoryImages: { none: {} },
      brandLogos: { none: {} },
    },
    orderBy: { createdAt: 'asc' },
  });
}
