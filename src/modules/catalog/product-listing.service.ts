import type { Brand, Prisma, Product, Variant } from '@generated/prisma';

import { db } from '@/modules/core';
import { getMediaPublicUrl, type ResolvedMediaImage } from '@/modules/media';

import { getDescendantCategoryIds } from './category.service';
import { getEffectiveAttributeDefinitions } from './attribute.service';
import { resolveListingPrice, type EffectivePrice } from './variant-pricing';
import { resolveVariantStockStatus, type StockStatus } from './stock-status';

/**
 * The one query every browse surface goes through — a category page, a
 * brand page, the homepage's "featured" rail, and (via `@/modules/search`,
 * which wraps this) the search results page. Nothing here is car-specific:
 * the only category-shaped input is `categoryId`, and the only
 * product-shaped inputs are the generic fields every product has
 * (name/brand/price/variants/attributes JSON).
 *
 * Scale note: filtering by computed fields (min variant price, stock,
 * JSON-stored attributes) happens in application code after a bounded
 * database fetch, not in SQL — correct at this catalog's current size, and
 * exactly the boundary a real search backend (Meilisearch/Typesense/Algolia,
 * already anticipated by `@/modules/search`'s `SearchProvider` interface)
 * takes over without any storefront code changing.
 */

export type ProductListingSort = 'newest' | 'price-asc' | 'price-desc' | 'featured';

export interface ProductListingQuery {
  categoryId?: string;
  brandIds?: string[];
  /** Restrict to an explicit id set — how a homepage section's curated
   * "Featured Products" list is rendered through the same one query path. */
  productIds?: string[];
  /** Only definitions marked `filterable` are meant to reach here — that's
   * enforced by the UI building its filter controls from
   * `getFilterableAttributes`, not by this function, which applies whatever
   * it's given. */
  attributeFilters?: Record<string, string[]>;
  priceMinMinor?: number;
  priceMaxMinor?: number;
  inStockOnly?: boolean;
  /** Free-text match against both locales' name and description. */
  q?: string;
  sort?: ProductListingSort;
  page?: number;
  pageSize?: number;
}

export interface ProductListingItem {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  brand: Pick<Brand, 'id' | 'slug' | 'nameAr' | 'nameEn'> | null;
  image: ResolvedMediaImage | null;
  price: EffectivePrice;
  stockStatus: StockStatus;
  variantCount: number;
  rating: { value: number; count: number } | null;
}

export interface ProductListingResult {
  items: ProductListingItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Brands present in the category/text-scoped result set, before the
   * attribute/price/availability narrowing — so picking one attribute
   * filter doesn't make every other brand option disappear. */
  availableBrands: Pick<Brand, 'id' | 'slug' | 'nameAr' | 'nameEn'>[];
  priceRange: { minMinor: number; maxMinor: number } | null;
}

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 60;

function stockStatusFor(
  variants: Pick<Variant, 'trackInventory' | 'stockQuantity' | 'lowStockThreshold'>[],
): StockStatus {
  const statuses = variants.map(resolveVariantStockStatus);
  if (statuses.every((s) => s === 'out-of-stock')) return 'out-of-stock';
  // "Low stock" is a listing-level signal only when every in-stock variant
  // is low — a product with one low variant and four healthy ones is still
  // just "in stock" from the outside.
  if (statuses.every((s) => s !== 'in-stock')) return 'low-stock';
  return 'in-stock';
}

const productRowInclude = {
  brand: true,
  category: true,
  variants: true,
  images: { orderBy: { position: 'asc' as const }, include: { media: true } },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productRowInclude }>;

function primaryImage(row: ProductRow, locale: 'ar' | 'en'): ResolvedMediaImage | null {
  const image = row.images.find((i) => i.isPrimary) ?? row.images[0];
  if (!image) return null;
  const alt = (locale === 'ar' ? image.media.altAr : image.media.altEn) ?? row.nameAr;
  return {
    src: getMediaPublicUrl(image.media),
    alt,
    width: image.media.width,
    height: image.media.height,
  };
}

function matchesAttributeFilters(
  attributes: unknown,
  filters: Record<string, string[]> | undefined,
): boolean {
  if (!filters || Object.keys(filters).length === 0) return true;
  const record = (attributes ?? {}) as Record<string, unknown>;
  return Object.entries(filters).every(([key, allowed]) => {
    if (allowed.length === 0) return true;
    const value = record[key];
    if (Array.isArray(value)) return value.some((v) => allowed.includes(String(v)));
    return value !== undefined && allowed.includes(String(value));
  });
}

export async function listProducts(
  query: ProductListingQuery,
  locale: 'ar' | 'en' = 'ar',
): Promise<ProductListingResult> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));

  const categoryIds = query.categoryId
    ? await getDescendantCategoryIds(query.categoryId)
    : undefined;

  const rows = await db.product.findMany({
    where: {
      status: 'PUBLISHED',
      deletedAt: null,
      ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
      ...(query.brandIds && query.brandIds.length > 0 ? { brandId: { in: query.brandIds } } : {}),
      ...(query.productIds && query.productIds.length > 0 ? { id: { in: query.productIds } } : {}),
      ...(query.q
        ? {
            OR: [
              { nameAr: { contains: query.q, mode: 'insensitive' } },
              { nameEn: { contains: query.q, mode: 'insensitive' } },
              { descriptionAr: { contains: query.q, mode: 'insensitive' } },
              { descriptionEn: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: productRowInclude,
  });

  // Facets are computed from this category+brand+text-scoped set, before
  // attribute/price/availability narrowing (see ProductListingResult docs).
  const availableBrandsMap = new Map<string, Pick<Brand, 'id' | 'slug' | 'nameAr' | 'nameEn'>>();
  for (const row of rows) {
    if (row.brand) {
      availableBrandsMap.set(row.brand.id, {
        id: row.brand.id,
        slug: row.brand.slug,
        nameAr: row.brand.nameAr,
        nameEn: row.brand.nameEn,
      });
    }
  }
  const scopedPrices = rows
    .filter((row) => row.variants.length > 0)
    .map((row) => resolveListingPrice(row.variants).currentMinor);
  const priceRange =
    scopedPrices.length > 0
      ? { minMinor: Math.min(...scopedPrices), maxMinor: Math.max(...scopedPrices) }
      : null;

  const withComputed = rows
    .filter((row) => row.variants.length > 0)
    .filter((row) => matchesAttributeFilters(row.attributes, query.attributeFilters))
    .map((row) => ({
      row,
      price: resolveListingPrice(row.variants),
      stock: stockStatusFor(row.variants),
    }))
    .filter(
      ({ price }) => query.priceMinMinor === undefined || price.currentMinor >= query.priceMinMinor,
    )
    .filter(
      ({ price }) => query.priceMaxMinor === undefined || price.currentMinor <= query.priceMaxMinor,
    )
    .filter(({ stock }) => !query.inStockOnly || stock !== 'out-of-stock');

  // An explicit, curated id list (a homepage section's "Featured Products")
  // keeps the store owner's chosen order unless a sort was explicitly asked
  // for — the same list re-sorted by price would defeat the point of
  // curating it.
  if (query.productIds && query.productIds.length > 0 && !query.sort) {
    const order = new Map(query.productIds.map((id, index) => [id, index]));
    const sorted = [...withComputed].sort(
      (a, b) => (order.get(a.row.id) ?? 0) - (order.get(b.row.id) ?? 0),
    );
    return paginate(sorted, page, pageSize, availableBrandsMap, priceRange, locale);
  }

  const sort = query.sort ?? (query.q ? 'featured' : 'newest');
  const sorted = [...withComputed].sort((a, b) => {
    switch (sort) {
      case 'price-asc':
        return a.price.currentMinor - b.price.currentMinor;
      case 'price-desc':
        return b.price.currentMinor - a.price.currentMinor;
      case 'featured':
        if (a.row.featured !== b.row.featured) return a.row.featured ? -1 : 1;
        return compareNewest(a.row, b.row);
      case 'newest':
      default:
        return compareNewest(a.row, b.row);
    }
  });

  return paginate(sorted, page, pageSize, availableBrandsMap, priceRange, locale);
}

async function paginate(
  sorted: { row: ProductRow; price: EffectivePrice; stock: StockStatus }[],
  page: number,
  pageSize: number,
  availableBrandsMap: Map<string, Pick<Brand, 'id' | 'slug' | 'nameAr' | 'nameEn'>>,
  priceRange: { minMinor: number; maxMinor: number } | null,
  locale: 'ar' | 'en',
): Promise<ProductListingResult> {
  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const pageRows = sorted.slice(start, start + pageSize);

  const ratings = await ratingSummaries(pageRows.map(({ row }) => row.id));

  const items: ProductListingItem[] = pageRows.map(({ row, price, stock }) => ({
    id: row.id,
    slug: row.slug,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    brand: row.brand
      ? {
          id: row.brand.id,
          slug: row.brand.slug,
          nameAr: row.brand.nameAr,
          nameEn: row.brand.nameEn,
        }
      : null,
    image: primaryImage(row, locale),
    price,
    stockStatus: stock,
    variantCount: row.variants.length,
    rating: ratings.get(row.id) ?? null,
  }));

  return {
    items,
    total,
    page,
    pageSize,
    pageCount,
    availableBrands: [...availableBrandsMap.values()].sort((a, b) =>
      a.nameEn.localeCompare(b.nameEn),
    ),
    priceRange,
  };
}

function compareNewest(a: Product, b: Product): number {
  const aTime = (a.publishedAt ?? a.createdAt).getTime();
  const bTime = (b.publishedAt ?? b.createdAt).getTime();
  return bTime - aTime;
}

async function ratingSummaries(
  productIds: string[],
): Promise<Map<string, { value: number; count: number }>> {
  if (productIds.length === 0) return new Map();
  const grouped = await db.review.groupBy({
    by: ['productId'],
    where: { productId: { in: productIds }, status: 'PUBLISHED' },
    _avg: { rating: true },
    _count: { _all: true },
  });
  return new Map(
    grouped
      .filter((g) => g._count._all > 0)
      .map((g) => [g.productId, { value: g._avg.rating ?? 0, count: g._count._all }]),
  );
}

export interface FilterableAttribute {
  key: string;
  labelAr: string;
  labelEn: string;
  type: 'TEXT' | 'NUMBER' | 'SELECT' | 'MULTI_SELECT' | 'BOOLEAN';
  allowedValues: string[];
}

/** The attribute-driven filter controls for a category page — every
 * `filterable` definition in its effective set (own + inherited). Nothing
 * here knows what those attributes mean; a category with no filterable
 * attributes simply gets no attribute filters, which is correct, not a bug
 * to work around. */
export async function getFilterableAttributes(categoryId: string): Promise<FilterableAttribute[]> {
  const definitions = await getEffectiveAttributeDefinitions(categoryId);
  return definitions
    .filter((d) => d.filterable)
    .map((d) => ({
      key: d.key,
      labelAr: d.labelAr,
      labelEn: d.labelEn,
      type: d.type,
      allowedValues: (d.allowedValues as string[] | null) ?? [],
    }));
}

/** Other published products in the same category, for a product detail
 * page's "related products" rail. Excludes the product itself. */
export async function getRelatedProducts(
  productId: string,
  categoryId: string,
  locale: 'ar' | 'en' = 'ar',
  limit = 8,
): Promise<ProductListingItem[]> {
  const result = await listProducts({ categoryId, pageSize: limit + 1, sort: 'newest' }, locale);
  return result.items.filter((item) => item.id !== productId).slice(0, limit);
}
