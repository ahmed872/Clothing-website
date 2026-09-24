import type { Prisma, ProductStatus } from '@generated/prisma';

import { db } from '@/modules/core';

import { resolveVariantStockStatus, type StockStatus } from './stock-status';

/**
 * One variant-level listing, shared by the admin inventory and pricing
 * screens (P08 §9/§10).
 *
 * Rows are *variants*, not products: both stock and price belong to the
 * variant, and an admin restocking size 41 in black should not have to page
 * through the product that owns it. The two screens differ only in which
 * filters they expose and how they sort, which is why this is one query
 * rather than two that drift apart.
 *
 * Lives in `catalog` because it reads catalog rows. `inventory` owns every
 * *write* to `stockQuantity`; nothing about that ownership requires a
 * second read path.
 *
 * Every filter is SQL. A catalog with ten thousand variants must never
 * become ten thousand rows in a browser.
 */

export type VariantStockFilter = 'in_stock' | 'low_stock' | 'out_of_stock' | 'untracked';
export type VariantListingSort =
  'stock-asc' | 'stock-desc' | 'price-asc' | 'price-desc' | 'sku-asc' | 'updated-desc';

export interface VariantListingQuery {
  /** Matches a variant SKU, or the product's Arabic/English name. */
  q?: string;
  productId?: string;
  categoryId?: string;
  brandId?: string;
  status?: ProductStatus;
  stock?: VariantStockFilter;
  page?: number;
  pageSize?: number;
  sort?: VariantListingSort;
}

export interface VariantListingItem {
  variantId: string;
  sku: string;
  /** The variant's own label if it has one, otherwise its option values
   * joined — "أسود / 40", "Black / 40". A generated variant has no explicit
   * label, and a screen that showed only its SKU would make an admin
   * cross-reference a code to find the size they are counting. */
  variantLabelAr: string | null;
  variantLabelEn: string | null;
  productId: string;
  productNameAr: string;
  productNameEn: string;
  productStatus: ProductStatus;
  stockQuantity: number;
  lowStockThreshold: number;
  trackInventory: boolean;
  stockStatus: StockStatus;
  priceMinor: number;
  compareAtMinor: number | null;
  updatedAt: Date;
}

export interface VariantListingResult {
  items: VariantListingItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * "Low stock" is `0 < quantity <= threshold` on a tracked variant — the same
 * rule `resolveVariantStockStatus` applies when rendering a badge, so the
 * filter and the badge can never disagree. Expressed as a `where` clause so
 * it narrows in the database rather than after the fact.
 */
function stockWhere(filter: VariantStockFilter): Prisma.VariantWhereInput {
  switch (filter) {
    case 'untracked':
      return { trackInventory: false };
    case 'out_of_stock':
      return { trackInventory: true, stockQuantity: { lte: 0 } };
    case 'low_stock':
      // The `quantity <= threshold` half is a column-to-column comparison,
      // applied below as a raw id narrowing; a threshold of 0 can never be
      // "low", only in or out of stock.
      return { trackInventory: true, stockQuantity: { gt: 0 }, lowStockThreshold: { gt: 0 } };
    case 'in_stock':
      return { OR: [{ trackInventory: false }, { stockQuantity: { gt: 0 } }] };
  }
}

function buildWhere(query: VariantListingQuery): Prisma.VariantWhereInput {
  const product: Prisma.ProductWhereInput = { deletedAt: null };
  if (query.productId) product.id = query.productId;
  if (query.categoryId) product.categoryId = query.categoryId;
  if (query.brandId) product.brandId = query.brandId;
  if (query.status) product.status = query.status;

  const where: Prisma.VariantWhereInput = { product: { is: product } };

  if (query.stock) Object.assign(where, stockWhere(query.stock));

  if (query.q) {
    where.OR = [
      { sku: { contains: query.q, mode: 'insensitive' } },
      { product: { is: { ...product, nameAr: { contains: query.q, mode: 'insensitive' } } } },
      { product: { is: { ...product, nameEn: { contains: query.q, mode: 'insensitive' } } } },
    ];
  }

  return where;
}

/** `id` is always the tiebreaker, so a page boundary can never drop or
 * repeat a row when two variants share a price or a quantity. */
function buildOrderBy(
  sort: VariantListingSort | undefined,
): Prisma.VariantOrderByWithRelationInput[] {
  switch (sort) {
    case 'stock-desc':
      return [{ stockQuantity: 'desc' }, { id: 'asc' }];
    case 'price-asc':
      return [{ priceMinor: 'asc' }, { id: 'asc' }];
    case 'price-desc':
      return [{ priceMinor: 'desc' }, { id: 'asc' }];
    case 'sku-asc':
      return [{ sku: 'asc' }, { id: 'asc' }];
    case 'updated-desc':
      return [{ updatedAt: 'desc' }, { id: 'asc' }];
    case 'stock-asc':
    default:
      // The default an inventory manager actually wants: whatever is closest
      // to running out, first.
      return [{ stockQuantity: 'asc' }, { id: 'asc' }];
  }
}

/** "Black / 40", in the order the options are defined — the same
 * composition the product edit page shows, so a variant is named
 * identically wherever an admin meets it. Null when the variant has no
 * options at all (a single-variant product), leaving the caller to fall
 * back to the SKU. */
function composeLabel(
  links: {
    optionValue: {
      valueAr: string;
      valueEn: string;
      position: number;
      option: { position: number };
    };
  }[],
  locale: 'ar' | 'en',
): string | null {
  if (links.length === 0) return null;
  return links
    .map((link) => link.optionValue)
    .sort((a, b) => a.option.position - b.option.position || a.position - b.position)
    .map((value) => (locale === 'ar' ? value.valueAr : value.valueEn))
    .join(' / ');
}

export async function listVariantsForAdmin(
  query: VariantListingQuery = {},
): Promise<VariantListingResult> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));
  const where = buildWhere(query);

  // The low-stock filter needs `stockQuantity <= lowStockThreshold`, a
  // column-to-column comparison Prisma's `where` cannot express. The ids
  // come from one raw query and narrow the main one, which keeps a single
  // paginated round trip rather than fetching rows to filter in memory.
  if (query.stock === 'low_stock') {
    const lowIds = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM variants
      WHERE track_inventory = true
        AND stock_quantity > 0
        AND stock_quantity <= low_stock_threshold
    `;
    where.id = { in: lowIds.map((row) => row.id) };
  }

  const [rows, total] = await Promise.all([
    db.variant.findMany({
      where,
      orderBy: buildOrderBy(query.sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        product: { select: { id: true, nameAr: true, nameEn: true, status: true } },
        // Bounded by the page size, so this is one extra join over at most
        // `pageSize` variants — not an N+1 over the catalog.
        optionValues: { include: { optionValue: { include: { option: true } } } },
      },
    }),
    db.variant.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      variantId: row.id,
      sku: row.sku,
      variantLabelAr: row.labelAr ?? composeLabel(row.optionValues, 'ar'),
      variantLabelEn: row.labelEn ?? composeLabel(row.optionValues, 'en'),
      productId: row.product.id,
      productNameAr: row.product.nameAr,
      productNameEn: row.product.nameEn,
      productStatus: row.product.status,
      stockQuantity: row.stockQuantity,
      lowStockThreshold: row.lowStockThreshold,
      trackInventory: row.trackInventory,
      stockStatus: resolveVariantStockStatus(row),
      priceMinor: row.priceMinor,
      compareAtMinor: row.compareAtMinor,
      updatedAt: row.updatedAt,
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}
