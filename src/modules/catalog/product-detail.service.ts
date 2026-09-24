import type { Brand, Category, Prisma } from '@generated/prisma';

import { db } from '@/modules/core';
import { getMediaPublicUrl, type ResolvedMediaImage } from '@/modules/media';

import { getAncestorChain } from './category.service';
import { getEffectiveAttributeDefinitions } from './attribute.service';
import { resolveEffectivePrice, type EffectivePrice } from './variant-pricing';
import { resolveVariantStockStatus, type StockStatus } from './stock-status';

/**
 * Everything a product detail page needs, assembled in one place so the
 * page component itself stays a pure render of already-resolved data — no
 * `if (category.slug === 'cars')` branch anywhere here or downstream.
 */

export interface ProductDetailVariant {
  id: string;
  sku: string;
  labelAr: string | null;
  labelEn: string | null;
  price: EffectivePrice;
  stockStatus: StockStatus;
  stockQuantity: number;
  weightGrams: number | null;
  optionValueIds: string[];
}

export interface ProductDetailOption {
  id: string;
  nameAr: string;
  nameEn: string;
  values: { id: string; valueAr: string; valueEn: string }[];
}

export interface ProductDetailAttribute {
  key: string;
  labelAr: string;
  labelEn: string;
  unit: string | null;
  value: unknown;
}

export interface ProductDetail {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  seoTitleAr: string | null;
  seoTitleEn: string | null;
  seoDescriptionAr: string | null;
  seoDescriptionEn: string | null;
  publishedAt: Date | null;
  brand: Pick<Brand, 'id' | 'slug' | 'nameAr' | 'nameEn'> | null;
  category: Pick<Category, 'id' | 'slug' | 'nameAr' | 'nameEn'>;
  breadcrumb: Pick<Category, 'id' | 'slug' | 'nameAr' | 'nameEn'>[];
  images: ResolvedMediaImage[];
  options: ProductDetailOption[];
  variants: ProductDetailVariant[];
  /** The variant selected when no option combination has been picked yet —
   * the first variant, in `position` order. For a simple (no-option)
   * product this is the only variant. */
  defaultVariantId: string;
  specifications: ProductDetailAttribute[];
  rating: { value: number; count: number } | null;
}

const detailInclude = {
  brand: true,
  category: true,
  images: { orderBy: { position: 'asc' as const }, include: { media: true } },
  options: {
    orderBy: { position: 'asc' as const },
    include: { values: { orderBy: { position: 'asc' as const } } },
  },
  variants: {
    orderBy: { position: 'asc' as const },
    include: { optionValues: { include: { optionValue: true } } },
  },
} satisfies Prisma.ProductInclude;

type DetailRow = Prisma.ProductGetPayload<{ include: typeof detailInclude }>;

function toVariant(variant: DetailRow['variants'][number]): ProductDetailVariant {
  return {
    id: variant.id,
    sku: variant.sku,
    labelAr: variant.labelAr,
    labelEn: variant.labelEn,
    price: resolveEffectivePrice(variant),
    stockStatus: resolveVariantStockStatus(variant),
    stockQuantity: variant.stockQuantity,
    weightGrams: variant.weightGrams,
    optionValueIds: variant.optionValues.map((ov) => ov.optionValueId),
  };
}

function toOption(option: DetailRow['options'][number]): ProductDetailOption {
  return {
    id: option.id,
    nameAr: option.nameAr,
    nameEn: option.nameEn,
    values: option.values.map((v) => ({ id: v.id, valueAr: v.valueAr, valueEn: v.valueEn })),
  };
}

async function buildSpecifications(row: DetailRow): Promise<ProductDetailAttribute[]> {
  const definitions = await getEffectiveAttributeDefinitions(row.categoryId);
  const attributes = (row.attributes ?? {}) as Record<string, unknown>;
  return definitions
    .filter((d) => attributes[d.key] !== undefined)
    .map((d) => ({
      key: d.key,
      labelAr: d.labelAr,
      labelEn: d.labelEn,
      unit: d.unit,
      value: attributes[d.key],
    }));
}

export async function getProductDetailBySlug(slug: string): Promise<ProductDetail | null> {
  const row = await db.product.findUnique({
    where: { slug },
    include: detailInclude,
  });
  if (!row || row.status !== 'PUBLISHED' || row.deletedAt) return null;

  return assembleDetail(row);
}

/**
 * The same assembled detail, by id, for a product in *any* status — what
 * the admin preview renders (P07 §10: see the product before publishing).
 *
 * Deliberately not reachable from the storefront: the only caller is the
 * admin preview page, which is behind `requirePermission('products.read')`
 * like every other admin route. Authorization is the admin session, never
 * a secret in the URL — an unauthenticated request to that page is
 * redirected to the login screen no matter what it knows about the id.
 * A soft-deleted product is still excluded: there is nothing to preview
 * about a product that has been removed.
 */
export async function getProductDetailForPreview(id: string): Promise<ProductDetail | null> {
  const row = await db.product.findUnique({ where: { id }, include: detailInclude });
  if (!row || row.deletedAt) return null;

  return assembleDetail(row);
}

async function assembleDetail(row: DetailRow): Promise<ProductDetail> {
  const [breadcrumb, specifications, ratingAgg] = await Promise.all([
    getAncestorChain(row.categoryId),
    buildSpecifications(row),
    db.review.aggregate({
      where: { productId: row.id, status: 'PUBLISHED' },
      _avg: { rating: true },
      _count: { _all: true },
    }),
  ]);

  const variants = row.variants.map(toVariant);

  return {
    id: row.id,
    slug: row.slug,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    descriptionAr: row.descriptionAr,
    descriptionEn: row.descriptionEn,
    seoTitleAr: row.seoTitleAr,
    seoTitleEn: row.seoTitleEn,
    seoDescriptionAr: row.seoDescriptionAr,
    seoDescriptionEn: row.seoDescriptionEn,
    publishedAt: row.publishedAt,
    brand: row.brand
      ? {
          id: row.brand.id,
          slug: row.brand.slug,
          nameAr: row.brand.nameAr,
          nameEn: row.brand.nameEn,
        }
      : null,
    category: {
      id: row.category.id,
      slug: row.category.slug,
      nameAr: row.category.nameAr,
      nameEn: row.category.nameEn,
    },
    breadcrumb: breadcrumb.map((c) => ({
      id: c.id,
      slug: c.slug,
      nameAr: c.nameAr,
      nameEn: c.nameEn,
    })),
    images: row.images.map((image) => ({
      src: getMediaPublicUrl(image.media),
      alt: image.media.altAr ?? row.nameAr,
      width: image.media.width,
      height: image.media.height,
    })),
    options: row.options.map(toOption),
    variants,
    defaultVariantId: variants[0]?.id ?? '',
    specifications,
    rating:
      ratingAgg._count._all > 0
        ? { value: ratingAgg._avg.rating ?? 0, count: ratingAgg._count._all }
        : null,
  };
}

export interface ProductReview {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  createdAt: Date;
  customerName: string;
}

/** Real reviews only — a product with none gets an honest empty state, not
 * a fabricated rating (the same rule P04 applied to media: never fake a
 * missing thing into looking present). */
export async function getProductReviews(productId: string, limit = 20): Promise<ProductReview[]> {
  const reviews = await db.review.findMany({
    where: { productId, status: 'PUBLISHED' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { customer: { include: { user: { select: { name: true, email: true } } } } },
  });

  return reviews.map((r) => ({
    id: r.id,
    rating: r.rating,
    title: r.title,
    body: r.body,
    createdAt: r.createdAt,
    customerName: r.customer.user.name ?? r.customer.user.email.split('@')[0] ?? 'Customer',
  }));
}
