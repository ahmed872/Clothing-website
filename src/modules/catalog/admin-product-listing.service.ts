import type { Prisma, ProductStatus } from '@generated/prisma';

import { db } from '@/modules/core';

import { resolveListingPrice, type EffectivePrice } from './variant-pricing';
import { resolveVariantStockStatus, type StockStatus } from './stock-status';

/**
 * The admin product list's one query. Deliberately separate from
 * `product-listing.service.ts#listProducts` (the storefront's), which is
 * hardcoded to `status: PUBLISHED` and paginates in application memory
 * after a bounded fetch — the admin list needs every status, admin-only
 * filter dimensions (status, exact stock), and genuine SQL-level
 * `skip`/`take` (P07 §20: never fetch everything and filter/paginate in the
 * browser — nor even in the server's own memory here, since an admin
 * catalog can be much larger than one page fetched at once).
 */

export type AdminProductSort = 'name-asc' | 'name-desc' | 'updated-desc' | 'updated-asc' | 'status';
export type AdminStockFilter = 'in_stock' | 'out_of_stock';

export interface AdminProductListingQuery {
  q?: string;
  status?: ProductStatus;
  categoryId?: string;
  brandId?: string;
  priceMinMinor?: number;
  priceMaxMinor?: number;
  stock?: AdminStockFilter;
  sort?: AdminProductSort;
  page?: number;
  pageSize?: number;
}

export interface AdminProductListingItem {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  status: ProductStatus;
  category: { id: string; nameAr: string; nameEn: string } | null;
  brand: { id: string; nameAr: string; nameEn: string } | null;
  skuSummary: string;
  variantCount: number;
  price: EffectivePrice | null;
  stockStatus: StockStatus | null;
  updatedAt: Date;
}

export interface AdminProductListingResult {
  items: AdminProductListingItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function buildWhere(query: AdminProductListingQuery): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = { deletedAt: null };

  if (query.status) where.status = query.status;
  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.brandId) where.brandId = query.brandId;

  if (query.priceMinMinor !== undefined || query.priceMaxMinor !== undefined) {
    where.variants = {
      some: {
        ...(query.priceMinMinor !== undefined ? { priceMinor: { gte: query.priceMinMinor } } : {}),
        ...(query.priceMaxMinor !== undefined ? { priceMinor: { lte: query.priceMaxMinor } } : {}),
      },
    };
  }

  if (query.stock === 'in_stock') {
    where.variants = {
      ...where.variants,
      some: { OR: [{ trackInventory: false }, { stockQuantity: { gt: 0 } }] },
    };
  } else if (query.stock === 'out_of_stock') {
    where.variants = { every: { trackInventory: true, stockQuantity: { lte: 0 } } };
  }

  if (query.q) {
    where.OR = [
      { nameAr: { contains: query.q, mode: 'insensitive' } },
      { nameEn: { contains: query.q, mode: 'insensitive' } },
      { variants: { some: { sku: { contains: query.q, mode: 'insensitive' } } } },
    ];
  }

  return where;
}

function buildOrderBy(sort: AdminProductSort | undefined): Prisma.ProductOrderByWithRelationInput {
  switch (sort) {
    case 'name-asc':
      return { nameEn: 'asc' };
    case 'name-desc':
      return { nameEn: 'desc' };
    case 'status':
      return { status: 'asc' };
    case 'updated-asc':
      return { updatedAt: 'asc' };
    case 'updated-desc':
    default:
      return { updatedAt: 'desc' };
  }
}

export async function listProductsForAdmin(
  query: AdminProductListingQuery,
): Promise<AdminProductListingResult> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));
  const where = buildWhere(query);

  const [rows, total] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: buildOrderBy(query.sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        category: { select: { id: true, nameAr: true, nameEn: true } },
        brand: { select: { id: true, nameAr: true, nameEn: true } },
        variants: { orderBy: { position: 'asc' } },
      },
    }),
    db.product.count({ where }),
  ]);

  const items: AdminProductListingItem[] = rows.map((row) => {
    const skus = row.variants.map((v) => v.sku);
    const skuSummary =
      skus.length === 0 ? '—' : skus.length === 1 ? skus[0]! : `${skus[0]} (+${skus.length - 1})`;

    return {
      id: row.id,
      slug: row.slug,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      status: row.status,
      category: row.category,
      brand: row.brand,
      skuSummary,
      variantCount: row.variants.length,
      price: row.variants.length > 0 ? resolveListingPrice(row.variants) : null,
      stockStatus:
        row.variants.length > 0
          ? row.variants
              .map(resolveVariantStockStatus)
              .reduce<StockStatus>(
                (worst, status) => (rank(status) > rank(worst) ? status : worst),
                'in-stock',
              )
          : null,
      updatedAt: row.updatedAt,
    };
  });

  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

function rank(status: StockStatus): number {
  return status === 'out-of-stock' ? 2 : status === 'low-stock' ? 1 : 0;
}
