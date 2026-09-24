import { z } from 'zod';
import type { OptionValue, ProductOption, Variant } from '@generated/prisma';

import { db, AppError } from '@/modules/core';

import { cartesianProduct, generateSku } from './variant-combinations';
import {
  assertPricingInvariants,
  optionValueInputSchema,
  productOptionInputSchema,
  variantInputSchema,
  type ProductOptionInput,
} from './schemas';
import { mapUniqueConstraint, mapForeignKeyRestrict } from './prisma-errors';

/**
 * Everything `product.service.ts#createProduct` doesn't cover: editing a
 * product's option/variant matrix *after* it exists. P03 only ever needed
 * to build a product's full matrix once, at creation; P07's admin needs to
 * add an option, add a value to an existing option, generate the variants a
 * new value/option requires, and edit or remove one variant at a time —
 * all without disturbing the variants nobody touched (their id, stock
 * history, and any real reference to them via `CartItem`/
 * `InventoryAdjustment` survives untouched).
 */

export interface ProductOptionWithValues extends ProductOption {
  values: OptionValue[];
}

export async function listProductOptions(productId: string): Promise<ProductOptionWithValues[]> {
  return db.productOption.findMany({
    where: { productId },
    include: { values: { orderBy: { position: 'asc' } } },
    orderBy: { position: 'asc' },
  });
}

/** Adds a whole new option (e.g. "Color") with its initial values to an
 * existing product. Does not itself create any variant — call
 * `generateMissingVariants` afterward to fill in the combinations this
 * option now requires. */
export async function createProductOption(
  productId: string,
  input: ProductOptionInput,
): Promise<ProductOptionWithValues> {
  const parsed = productOptionInputSchema.parse(input);
  await getProductOrThrow(productId);

  try {
    return await db.productOption.create({
      data: {
        productId,
        nameAr: parsed.nameAr,
        nameEn: parsed.nameEn,
        values: { create: parsed.values },
      },
      include: { values: true },
    });
  } catch (error) {
    throw mapUniqueConstraint(error, 'nameEn');
  }
}

/** Adds more values to an existing option (e.g. a "Red" added to "Color"
 * after the fact). */
export async function addOptionValues(
  optionId: string,
  values: { valueAr: string; valueEn: string }[],
): Promise<OptionValue[]> {
  const option = await db.productOption.findUnique({ where: { id: optionId } });
  if (!option)
    throw new AppError('NOT_FOUND', { details: { entity: 'ProductOption', id: optionId } });

  const parsed = z.array(optionValueInputSchema).min(1).parse(values);
  try {
    return await db.$transaction(
      parsed.map((value) => db.optionValue.create({ data: { optionId, ...value } })),
    );
  } catch (error) {
    throw mapUniqueConstraint(error, 'valueEn');
  }
}

/** Removes an option (and its values) entirely — blocked while any variant
 * still uses one of its values, so a variant a real cart/order might
 * reference is never silently orphaned by an option going away. */
export async function deleteProductOption(id: string): Promise<void> {
  const option = await db.productOption.findUnique({
    where: { id },
    include: { values: { include: { variantValues: true } } },
  });
  if (!option) throw new AppError('NOT_FOUND', { details: { entity: 'ProductOption', id } });

  const inUse = option.values.some((value) => value.variantValues.length > 0);
  if (inUse) {
    throw new AppError('CONFLICT', {
      internalMessage: 'Option still has variants using it',
      details: { reasonCode: 'option_in_use' },
    });
  }

  await db.productOption.delete({ where: { id } });
}

export async function deleteOptionValue(id: string): Promise<void> {
  const value = await db.optionValue.findUnique({
    where: { id },
    include: { variantValues: true },
  });
  if (!value) throw new AppError('NOT_FOUND', { details: { entity: 'OptionValue', id } });

  if (value.variantValues.length > 0) {
    throw new AppError('CONFLICT', {
      internalMessage: 'Option value still has variants using it',
      details: { reasonCode: 'option_value_in_use' },
    });
  }

  await db.optionValue.delete({ where: { id } });
}

function comboIdKey(optionValueIds: string[]): string {
  return [...optionValueIds].sort().join('|');
}

/**
 * The "Generate combinations" action: computes the full cartesian product of
 * the product's *current* options/values and creates a new `Variant` (a
 * placeholder: `priceMinor: 0`, an auto SKU, out of stock — every field the
 * admin edits next) for every combination that doesn't already have one.
 * Existing variants — and every edit already made to them — are never
 * touched, so this is safe to call again after adding one more option value:
 * only the new combinations it introduces get created.
 *
 * A product with no options gets exactly one default variant, the same
 * "one variant, no options" shape `createProduct` already establishes.
 */
export async function generateMissingVariants(productId: string): Promise<Variant[]> {
  const product = await getProductOrThrow(productId);
  const options = await db.productOption.findMany({
    where: { productId },
    include: { values: { orderBy: { position: 'asc' } } },
    orderBy: { position: 'asc' },
  });

  if (options.length === 0) {
    const existing = await db.variant.findFirst({ where: { productId } });
    if (existing) return [];
    const created = await db.variant.create({
      data: {
        productId,
        sku: await uniqueSku(generateSku(product.slug, 'default')),
        priceMinor: 0,
      },
    });
    return [created];
  }

  const optionInputs: ProductOptionInput[] = options.map((option) => ({
    nameAr: option.nameAr,
    nameEn: option.nameEn,
    values: option.values.map((value) => ({ valueAr: value.valueAr, valueEn: value.valueEn })),
  }));
  const combinations = cartesianProduct(optionInputs);

  const valueIdByNameAndValue = new Map<string, Map<string, string>>();
  for (const option of options) {
    valueIdByNameAndValue.set(option.nameEn, new Map(option.values.map((v) => [v.valueEn, v.id])));
  }

  const existingVariants = await db.variant.findMany({
    where: { productId },
    include: { optionValues: true },
  });
  const existingKeys = new Set(
    existingVariants.map((variant) =>
      comboIdKey(variant.optionValues.map((ov) => ov.optionValueId)),
    ),
  );

  const created: Variant[] = [];
  for (const combo of combinations) {
    const optionValueIds = combo.map((ref) => {
      const id = valueIdByNameAndValue.get(ref.optionNameEn)?.get(ref.valueEn);
      if (!id) {
        throw new AppError('INTERNAL', {
          internalMessage: `Unresolved option value: ${ref.valueEn}`,
        });
      }
      return id;
    });
    if (existingKeys.has(comboIdKey(optionValueIds))) continue;

    const sku = await uniqueSku(generateSku(product.slug, ...combo.map((c) => c.valueEn)));
    const variant = await db.variant.create({
      data: {
        productId,
        sku,
        priceMinor: 0,
        optionValues: { create: optionValueIds.map((optionValueId) => ({ optionValueId })) },
      },
    });
    created.push(variant);
  }

  return created;
}

async function uniqueSku(base: string): Promise<string> {
  let candidate = base;
  let suffix = 2;
  while (await db.variant.findUnique({ where: { sku: candidate }, select: { id: true } })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/**
 * What a catalog edit may change about a variant.
 *
 * Deliberately without `stockQuantity`, `trackInventory` and
 * `lowStockThreshold`: stock is `inventory`'s (P08 §2). Letting this
 * function write the counter would give the application a second, unaudited
 * way to change stock — the exact thing `inventory.adjustStock` exists to
 * prevent — and `catalog` cannot call `inventory` (the dependency runs the
 * other way), so the field is simply not writable from here.
 */
export interface UpdateVariantInput {
  sku?: string;
  labelAr?: string | null;
  labelEn?: string | null;
  priceMinor?: number;
  compareAtMinor?: number | null;
  salePriceMinor?: number | null;
  saleStartsAt?: Date | null;
  saleEndsAt?: Date | null;
  weightGrams?: number | null;
  position?: number;
}

const updateVariantSchema = variantInputSchema
  .omit({
    optionValues: true,
    stockQuantity: true,
    trackInventory: true,
    lowStockThreshold: true,
  })
  .partial()
  .strict();

/**
 * Edits one variant's own fields — never its option combination (changing
 * which combination a variant represents isn't an edit, it's a different
 * variant; delete and generate the right one instead), and never its stock.
 *
 * Pricing invariants are checked against the variant's *resulting* state,
 * not just the fields in this call: raising the price alone can invalidate a
 * compare-at figure that was set months ago, and the check has to catch
 * that.
 *
 * `expectedUpdatedAt`, when passed, is the optimistic-concurrency check: if
 * someone else saved a change to this exact variant since the caller last
 * read it, this rejects with `CONFLICT` rather than silently overwriting
 * their edit — the same check `updateProduct` applies at the product level.
 */
export async function updateVariant(
  id: string,
  input: UpdateVariantInput,
  expectedUpdatedAt?: Date,
): Promise<Variant> {
  const parsed = updateVariantSchema.parse(input);
  const existing = await getVariantOrThrow(id);

  if (expectedUpdatedAt && existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    // No `reasonCode` needed — `CONFLICT`'s own generic bilingual message
    // ("this item changed somewhere else, refresh and try again") already
    // says exactly the right thing for a stale-version conflict.
    throw new AppError('CONFLICT', {
      internalMessage: 'Stale expectedUpdatedAt on variant update',
    });
  }

  const invariants = assertPricingInvariants({ ...existing, ...parsed });
  if (!invariants.ok) {
    throw new AppError('VALIDATION_FAILED', {
      internalMessage: `Pricing invariant violated: ${invariants.reasonCode}`,
      details: { reasonCode: invariants.reasonCode },
    });
  }

  try {
    return await db.variant.update({ where: { id }, data: parsed });
  } catch (error) {
    throw mapUniqueConstraint(error, 'sku');
  }
}

/**
 * Removes one variant. Blocked by the database itself (`onDelete: Restrict`
 * on `CartItem.variant` / `InventoryAdjustment.variant`) the moment a real
 * cart or stock-adjustment history references it — translated here into a
 * clear reason rather than a raw driver error. Also blocked at the
 * application level while it is the *last* variant of a `PUBLISHED`
 * product: a published product must keep at least one variant (the same
 * rule `assertPublishable` enforces on the way in).
 */
export async function deleteVariant(id: string): Promise<void> {
  const variant = await getVariantOrThrow(id);
  const product = await db.product.findUnique({ where: { id: variant.productId } });

  if (product?.status === 'PUBLISHED') {
    const remaining = await db.variant.count({ where: { productId: variant.productId } });
    if (remaining <= 1) {
      throw new AppError('INVALID_STATE_TRANSITION', {
        internalMessage: 'Refused to delete the last variant of a published product',
        details: { reasonCode: 'published_product_needs_variant' },
      });
    }
  }

  try {
    await db.variant.delete({ where: { id } });
  } catch (error) {
    throw mapForeignKeyRestrict(error, 'variant_still_referenced');
  }
}

export async function listVariants(productId: string): Promise<Variant[]> {
  return db.variant.findMany({ where: { productId }, orderBy: { position: 'asc' } });
}

export interface VariantWithOptionValues extends Variant {
  /** In option order (`Color` before `Size`, as the product defines them),
   * so a caller composing a label gets "Black / 41", never "41 / Black". */
  optionValues: (OptionValue & { option: ProductOption })[];
}

/** `listVariants` plus each variant's option values and the option each one
 * belongs to — what an admin variant table needs to name its rows, and the
 * one join a caller would otherwise have to do itself. */
export async function listVariantsWithOptionValues(
  productId: string,
): Promise<VariantWithOptionValues[]> {
  const variants = await db.variant.findMany({
    where: { productId },
    orderBy: { position: 'asc' },
    include: {
      optionValues: { include: { optionValue: { include: { option: true } } } },
    },
  });

  return variants.map((variant) => ({
    ...variant,
    optionValues: variant.optionValues
      .map((link) => link.optionValue)
      .sort((a, b) => a.option.position - b.option.position || a.position - b.position),
  }));
}

export async function getVariant(id: string): Promise<Variant | null> {
  return db.variant.findUnique({ where: { id } });
}

async function getVariantOrThrow(id: string): Promise<Variant> {
  const variant = await getVariant(id);
  if (!variant) throw new AppError('NOT_FOUND', { details: { entity: 'Variant', id } });
  return variant;
}

async function getProductOrThrow(
  id: string,
): Promise<{ id: string; slug: string; status: string }> {
  const product = await db.product.findUnique({
    where: { id },
    select: { id: true, slug: true, status: true },
  });
  if (!product) throw new AppError('NOT_FOUND', { details: { entity: 'Product', id } });
  return product;
}
