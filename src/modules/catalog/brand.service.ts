import type { Brand } from '@generated/prisma';

import { db } from '@/modules/core';
import { AppError } from '@/modules/core';

import {
  brandInputSchema,
  brandUpdateSchema,
  type BrandInput,
  type BrandUpdateInput,
} from './schemas';
import { mapUniqueConstraint } from './prisma-errors';

/** Brands are generic from day one — nothing here mentions cars, or any other category. */

export async function createBrand(input: BrandInput): Promise<Brand> {
  const parsed = brandInputSchema.parse(input);
  try {
    return await db.brand.create({ data: parsed });
  } catch (error) {
    throw mapUniqueConstraint(error, 'slug');
  }
}

export async function updateBrand(id: string, input: BrandUpdateInput): Promise<Brand> {
  const parsed = brandUpdateSchema.parse(input);
  await getBrandOrThrow(id);
  try {
    return await db.brand.update({ where: { id }, data: parsed });
  } catch (error) {
    throw mapUniqueConstraint(error, 'slug');
  }
}

/**
 * Removes a brand outright — blocked while any product still references it.
 * `Product.brand`'s own FK is `onDelete: SetNull` (deleting a brand would
 * otherwise silently detach it from every product that had it), which is
 * exactly the "breaks products" P07 asks not to allow: this checks first and
 * refuses with a specific count instead of ever letting that silent
 * detachment happen.
 */
export async function deleteBrand(id: string): Promise<void> {
  await getBrandOrThrow(id);

  const productCount = await db.product.count({ where: { brandId: id } });
  if (productCount > 0) {
    throw new AppError('CONFLICT', {
      internalMessage: `Brand assigned to ${productCount} products`,
      details: { reasonCode: 'brand_has_products', count: productCount },
    });
  }

  await db.brand.delete({ where: { id } });
}

export async function getBrand(id: string): Promise<Brand | null> {
  return db.brand.findUnique({ where: { id } });
}

export async function getBrandBySlug(slug: string): Promise<Brand | null> {
  return db.brand.findUnique({ where: { slug } });
}

export async function listBrands(): Promise<Brand[]> {
  return db.brand.findMany({ orderBy: { nameEn: 'asc' } });
}

/** The admin brand list's one read — brands plus how many products
 * currently reference each, which is exactly the number `deleteBrand`
 * refuses to bypass, so showing it up front is what tells an admin whether
 * a brand can be deleted without them having to try first. */
export async function listBrandsWithProductCounts(): Promise<(Brand & { productCount: number })[]> {
  const brands = await db.brand.findMany({
    orderBy: { nameEn: 'asc' },
    include: { _count: { select: { products: true } } },
  });
  return brands.map(({ _count, ...brand }) => ({ ...brand, productCount: _count.products }));
}

async function getBrandOrThrow(id: string): Promise<Brand> {
  const brand = await getBrand(id);
  if (!brand) throw new AppError('NOT_FOUND', { details: { entity: 'Brand', id } });
  return brand;
}
