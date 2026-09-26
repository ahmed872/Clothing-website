import type { Prisma, ProductSizing, SizeChartEntry, OptionValue } from '@generated/prisma';

import { AppError, db } from '@/modules/core';

import {
  GARMENT_MEASUREMENT_KEYS,
  type GarmentMeasurementKey,
  type GarmentType,
  type SizeChartMeasurements,
} from './garment-types';
import { sizeChartInputSchema, type SizeChartInput } from './size-chart.schemas';
import type { SizeChartRow } from './size-recommendation';
import { chartMeasurementsFor } from './sizing-rules';

/**
 * A product's sizing — its garment type and size chart (clothing P02).
 *
 * Reads and writes are keyed by the product id alone. Everything else a
 * write names — the size option, each size — is checked, inside the same
 * transaction as the write, to belong to *that* product: a crafted request
 * cannot attach another product's sizes (or a size that is not a size) to a
 * chart. The stored values are centimetres, locale-free; names come from
 * the product's own option values, in both languages.
 */

export interface SizeChartEntryView {
  optionValueId: string;
  labelAr: string;
  labelEn: string;
  measurements: SizeChartMeasurements;
}

export interface ProductSizingView {
  productId: string;
  garmentType: GarmentType;
  sizeOption: { id: string; nameAr: string; nameEn: string } | null;
  /** Smallest first. */
  entries: SizeChartEntryView[];
  updatedAt: Date;
}

type SizingWithEntries = ProductSizing & {
  sizeOption: { id: string; nameAr: string; nameEn: string } | null;
  entries: (SizeChartEntry & { optionValue: OptionValue })[];
};

const sizingInclude = {
  sizeOption: { select: { id: true, nameAr: true, nameEn: true } },
  entries: { orderBy: { position: 'asc' as const }, include: { optionValue: true } },
} satisfies Prisma.ProductSizingInclude;

function measurementsOf(entry: SizeChartEntry): SizeChartMeasurements {
  const measurements: SizeChartMeasurements = {};
  for (const key of GARMENT_MEASUREMENT_KEYS) {
    const value = entry[key];
    if (value !== null) measurements[key] = value.toNumber();
  }
  return measurements;
}

function toView(sizing: SizingWithEntries): ProductSizingView {
  return {
    productId: sizing.productId,
    garmentType: sizing.garmentType,
    sizeOption: sizing.sizeOption,
    entries: sizing.entries.map((entry) => ({
      optionValueId: entry.optionValueId,
      labelAr: entry.optionValue.valueAr,
      labelEn: entry.optionValue.valueEn,
      measurements: measurementsOf(entry),
    })),
    updatedAt: sizing.updatedAt,
  };
}

export async function getProductSizing(productId: string): Promise<ProductSizingView | null> {
  const sizing = await db.productSizing.findUnique({
    where: { productId },
    include: sizingInclude,
  });
  return sizing ? toView(sizing) : null;
}

function sizingError(reasonCode: string, code: 'VALIDATION_FAILED' | 'CONFLICT' | 'NOT_FOUND') {
  return new AppError(code, { details: { reasonCode } });
}

export interface SaveProductSizingOptions {
  /** The version the editor was showing (`updatedAt`), or `null` when it
   * was opened before the product had sizing. A save against anything else
   * is refused rather than overwriting another admin's edit. */
  expectedUpdatedAt?: Date | null;
}

/**
 * Creates or replaces a product's sizing: garment type, size option and the
 * whole chart, in the order given (smallest first). One transaction, so a
 * refused save changes nothing.
 */
export async function saveProductSizing(
  productId: string,
  input: SizeChartInput,
  options: SaveProductSizingOptions = {},
): Promise<ProductSizingView> {
  const data = sizeChartInputSchema.parse(input);

  return db.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { id: true, deletedAt: true },
    });
    if (!product || product.deletedAt) throw sizingError('sizing_product_not_found', 'NOT_FOUND');

    if (data.sizeOptionId) {
      const option = await tx.productOption.findUnique({
        where: { id: data.sizeOptionId },
        select: { productId: true, values: { select: { id: true } } },
      });
      if (!option || option.productId !== productId) {
        throw sizingError('sizing_option_not_on_product', 'VALIDATION_FAILED');
      }
      const valueIds = new Set(option.values.map((value) => value.id));
      if (data.entries.some((entry) => !valueIds.has(entry.optionValueId))) {
        throw sizingError('sizing_value_not_in_option', 'VALIDATION_FAILED');
      }
    }

    const existing = await tx.productSizing.findUnique({ where: { productId } });
    const expected = options.expectedUpdatedAt;
    const fields = { garmentType: data.garmentType, sizeOptionId: data.sizeOptionId };

    let sizingId: string;
    if (existing) {
      if (expected === null) throw sizingError('sizing_stale', 'CONFLICT');
      if (expected && existing.updatedAt.getTime() !== expected.getTime()) {
        throw sizingError('sizing_stale', 'CONFLICT');
      }
      // Conditional on the version just read: of two saves racing past the
      // check above, the second matches no row.
      const updated = await tx.productSizing.updateMany({
        where: { id: existing.id, updatedAt: existing.updatedAt },
        data: fields,
      });
      if (updated.count !== 1) throw sizingError('sizing_stale', 'CONFLICT');
      sizingId = existing.id;
      await tx.sizeChartEntry.deleteMany({ where: { sizingId } });
    } else {
      if (expected) throw sizingError('sizing_stale', 'CONFLICT');
      const created = await tx.productSizing.create({ data: { productId, ...fields } });
      sizingId = created.id;
    }

    if (data.entries.length > 0) {
      await tx.sizeChartEntry.createMany({
        data: data.entries.map((entry, position) => ({
          sizingId,
          optionValueId: entry.optionValueId,
          position,
          ...entry.measurements,
        })),
      });
    }

    const saved = await tx.productSizing.findUniqueOrThrow({
      where: { id: sizingId },
      include: sizingInclude,
    });
    return toView(saved);
  });
}

/** Removes a product's sizing and chart. Returns whether there was any. */
export async function deleteProductSizing(productId: string): Promise<boolean> {
  const { count } = await db.productSizing.deleteMany({ where: { productId } });
  return count > 0;
}

/** What a shopper may see of a product's sizing: only for a published,
 * live product, and only measurements this garment's chart can hold. */
export interface StorefrontSizeChart {
  garmentType: GarmentType;
  /** The chart's columns, in chart order: only those some size fills. */
  columns: GarmentMeasurementKey[];
  rows: SizeChartRow[];
}

export async function getStorefrontSizeChart(
  productId: string,
): Promise<StorefrontSizeChart | null> {
  const sizing = await db.productSizing.findFirst({
    where: { productId, product: { status: 'PUBLISHED', deletedAt: null } },
    include: sizingInclude,
  });
  if (!sizing || sizing.entries.length === 0) return null;
  const view = toView(sizing);
  const applicable = chartMeasurementsFor(view.garmentType);
  const rows: SizeChartRow[] = view.entries.map((entry) => ({
    sizeId: entry.optionValueId,
    label: { ar: entry.labelAr, en: entry.labelEn },
    measurements: Object.fromEntries(
      applicable
        .filter((key) => typeof entry.measurements[key] === 'number')
        .map((key) => [key, entry.measurements[key]]),
    ) as SizeChartMeasurements,
  }));
  const columns = applicable.filter((key) =>
    rows.some((row) => typeof row.measurements[key] === 'number'),
  );
  return { garmentType: view.garmentType, columns, rows };
}
