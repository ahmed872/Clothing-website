import type { ProductImage } from '@generated/prisma';

import { db, AppError } from '@/modules/core';
import { getMediaAsset } from '@/modules/media';

import { isUniqueConstraintError } from './prisma-errors';

/**
 * `ProductImage` is the association layer the Blueprint calls for: it knows
 * about products and ordering, `MediaAsset` (in `media`) knows about bytes
 * and storage. Nothing here creates, deletes, or otherwise reaches into a
 * `MediaAsset`'s own lifecycle — attaching one to a product no more "belongs"
 * to it than a library book belongs to whoever currently has it checked out.
 */

export async function attachProductImage(
  productId: string,
  mediaId: string,
  options: { isPrimary?: boolean } = {},
): Promise<ProductImage> {
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) throw new AppError('NOT_FOUND', { details: { entity: 'Product', id: productId } });

  const media = await getMediaAsset(mediaId);
  if (!media) throw new AppError('NOT_FOUND', { details: { entity: 'MediaAsset', id: mediaId } });

  const existing = await db.productImage.findMany({
    where: { productId },
    select: { position: true },
  });
  const nextPosition = existing.length === 0 ? 0 : Math.max(...existing.map((i) => i.position)) + 1;
  const makePrimary = options.isPrimary ?? existing.length === 0; // first image defaults to primary

  return db.$transaction(async (tx) => {
    if (makePrimary) {
      await tx.productImage.updateMany({ where: { productId }, data: { isPrimary: false } });
    }
    try {
      return await tx.productImage.create({
        data: { productId, mediaId, position: nextPosition, isPrimary: makePrimary },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError('CONFLICT', {
          cause: error,
          details: { reason: 'This image is already attached to this product' },
        });
      }
      throw error;
    }
  });
}

/** Removes the association only — the underlying `MediaAsset` is untouched
 * and, if still referenced elsewhere, still exists and stays exactly as
 * valid there as it was before. */
export async function detachProductImage(id: string): Promise<void> {
  const image = await getProductImageOrThrow(id);
  await db.productImage.delete({ where: { id } });

  // If the detached image was primary, promote the next one in order rather
  // than leaving the product with no primary image at all.
  if (image.isPrimary) {
    const next = await db.productImage.findFirst({
      where: { productId: image.productId },
      orderBy: { position: 'asc' },
    });
    if (next) await db.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
  }
}

export async function setPrimaryProductImage(id: string): Promise<ProductImage> {
  const image = await getProductImageOrThrow(id);
  return db.$transaction(async (tx) => {
    await tx.productImage.updateMany({
      where: { productId: image.productId },
      data: { isPrimary: false },
    });
    return tx.productImage.update({ where: { id }, data: { isPrimary: true } });
  });
}

/** All-or-nothing, same rule as `category.service.ts#reorderCategories`: the
 * given ids must be exactly the product's current images or nothing moves. */
export async function reorderProductImages(productId: string, orderedIds: string[]): Promise<void> {
  const current = await db.productImage.findMany({ where: { productId }, select: { id: true } });
  const currentIds = new Set(current.map((i) => i.id));

  if (orderedIds.length !== currentIds.size || orderedIds.some((id) => !currentIds.has(id))) {
    throw new AppError('VALIDATION_FAILED', {
      details: { reason: 'orderedIds must be exactly the current images of this product' },
    });
  }

  await db.$transaction(
    orderedIds.map((id, position) => db.productImage.update({ where: { id }, data: { position } })),
  );
}

export async function listProductImages(productId: string): Promise<ProductImage[]> {
  return db.productImage.findMany({ where: { productId }, orderBy: { position: 'asc' } });
}

async function getProductImageOrThrow(id: string): Promise<ProductImage> {
  const image = await db.productImage.findUnique({ where: { id } });
  if (!image) throw new AppError('NOT_FOUND', { details: { entity: 'ProductImage', id } });
  return image;
}
