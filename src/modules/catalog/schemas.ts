import { z } from 'zod';

import { slugSchema } from './slug';

/**
 * Input schemas for the catalog domain.
 *
 * These validate shape and type only — a schema alone can't check that a
 * parent category exists or that a slug is free, since those need a database
 * round trip. That validation lives in the services (`*.service.ts`), which
 * call `.parse()`/`.safeParse()` here first and then do the checks a schema
 * can't express.
 */

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable().optional();
const bilingualText = z.string().min(1).max(500);
const optionalText = z.string().min(1).max(2000).nullable().optional();

export const attributeTypeSchema = z.enum(['TEXT', 'NUMBER', 'BOOLEAN', 'SELECT', 'MULTI_SELECT']);
export type AttributeTypeInput = z.infer<typeof attributeTypeSchema>;

export const productStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

export const categoryInputSchema = z.object({
  parentId: nullableUuid,
  slug: slugSchema,
  nameAr: bilingualText,
  nameEn: bilingualText,
  descriptionAr: optionalText,
  descriptionEn: optionalText,
  imageMediaId: nullableUuid,
  position: z.number().int().min(0).optional(),
  seoTitleAr: optionalText,
  seoTitleEn: optionalText,
  seoDescriptionAr: optionalText,
  seoDescriptionEn: optionalText,
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

export const categoryUpdateSchema = categoryInputSchema.partial();
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

export const brandInputSchema = z.object({
  slug: slugSchema,
  nameAr: bilingualText,
  nameEn: bilingualText,
  logoMediaId: nullableUuid,
});
export type BrandInput = z.infer<typeof brandInputSchema>;

export const brandUpdateSchema = brandInputSchema.partial();
export type BrandUpdateInput = z.infer<typeof brandUpdateSchema>;

// ---------------------------------------------------------------------------
// Attribute definitions
// ---------------------------------------------------------------------------

/** `key` is a machine identifier (used as a JSON object key and, once set,
 * effectively permanent — changing it orphans every product's stored value),
 * so it gets its own, stricter pattern rather than reusing the slug one. */
const attributeKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'Attribute key must be lowercase snake_case, starting with a letter');

export const attributeDefinitionInputSchema = z
  .object({
    categoryId: uuid,
    key: attributeKeySchema,
    labelAr: bilingualText,
    labelEn: bilingualText,
    type: attributeTypeSchema,
    unit: z.string().min(1).max(32).nullable().optional(),
    allowedValues: z.array(z.string().min(1)).min(1).nullable().optional(),
    required: z.boolean().optional(),
    filterable: z.boolean().optional(),
    displayOrder: z.number().int().optional(),
  })
  .superRefine((value, ctx) => {
    const needsAllowedValues = value.type === 'SELECT' || value.type === 'MULTI_SELECT';
    if (needsAllowedValues && (!value.allowedValues || value.allowedValues.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowedValues'],
        message: `allowedValues is required for a ${value.type} attribute`,
      });
    }
    if (!needsAllowedValues && value.allowedValues) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowedValues'],
        message: `allowedValues is only meaningful for SELECT/MULTI_SELECT, not ${value.type}`,
      });
    }
  });
export type AttributeDefinitionInput = z.infer<typeof attributeDefinitionInputSchema>;

export const attributeDefinitionUpdateSchema = z
  .object({
    labelAr: bilingualText.optional(),
    labelEn: bilingualText.optional(),
    type: attributeTypeSchema.optional(),
    unit: z.string().min(1).max(32).nullable().optional(),
    allowedValues: z.array(z.string().min(1)).min(1).nullable().optional(),
    required: z.boolean().optional(),
    filterable: z.boolean().optional(),
    displayOrder: z.number().int().optional(),
  })
  .partial();
export type AttributeDefinitionUpdateInput = z.infer<typeof attributeDefinitionUpdateSchema>;

// ---------------------------------------------------------------------------
// Product core fields (attributes JSON is validated dynamically — see
// attribute.service.ts — not by this static schema)
// ---------------------------------------------------------------------------

export const productCoreInputSchema = z.object({
  slug: slugSchema,
  nameAr: bilingualText,
  nameEn: bilingualText,
  descriptionAr: optionalText,
  descriptionEn: optionalText,
  categoryId: uuid,
  brandId: nullableUuid,
  featured: z.boolean().optional(),
  status: productStatusSchema.optional(),
  /** Category-defined attributes — validated against the category's
   * effective AttributeDefinition set by `validateProductAttributes`. */
  attributes: z.record(z.string(), z.unknown()).optional(),
  seoTitleAr: optionalText,
  seoTitleEn: optionalText,
  seoDescriptionAr: optionalText,
  seoDescriptionEn: optionalText,
});
export type ProductCoreInput = z.infer<typeof productCoreInputSchema>;

export const productUpdateSchema = productCoreInputSchema.partial();
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

// ---------------------------------------------------------------------------
// Options and variants
// ---------------------------------------------------------------------------

export const optionValueInputSchema = z.object({
  valueAr: bilingualText,
  valueEn: bilingualText,
});

export const productOptionInputSchema = z.object({
  nameAr: bilingualText,
  nameEn: bilingualText,
  values: z.array(optionValueInputSchema).min(1, 'An option needs at least one value'),
});
export type ProductOptionInput = z.infer<typeof productOptionInputSchema>;

const skuSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'SKU must be alphanumeric (., _, - allowed), no spaces');

/**
 * The pricing invariants every variant must satisfy, wherever it is written
 * from — creation, a single edit, or a bulk update (P08 §7). Enforced here,
 * in the schema the services parse with, so no caller can reach the
 * database around them and an HTML `min=0` is never the only thing standing
 * between the catalog and a negative price.
 *
 * Amounts stay integer minor units throughout (ADR-006/ADR-022); a
 * fractional halala is not a price, it is a rounding bug.
 */
export const priceMinorSchema = z
  .number()
  .int('Prices are whole minor units — no fractions of a halala')
  .nonnegative('A price cannot be negative')
  // Well past any real product, and below Number.MAX_SAFE_INTEGER: a value
  // this large is a typo or an overflow, not a price.
  .max(1_000_000_000, 'That price is implausibly large');

export function assertPricingInvariants(value: {
  priceMinor?: number;
  compareAtMinor?: number | null;
  salePriceMinor?: number | null;
  saleStartsAt?: Date | null;
  saleEndsAt?: Date | null;
}): { ok: true } | { ok: false; reasonCode: string } {
  const { priceMinor, compareAtMinor, salePriceMinor, saleStartsAt, saleEndsAt } = value;

  // A compare-at price is the struck-through "was" figure. Equal to or below
  // the real price it advertises no saving at all, which reads to a customer
  // as a fake discount.
  if (
    priceMinor !== undefined &&
    compareAtMinor !== undefined &&
    compareAtMinor !== null &&
    compareAtMinor <= priceMinor
  ) {
    return { ok: false, reasonCode: 'compare_at_not_above_price' };
  }

  if (
    priceMinor !== undefined &&
    salePriceMinor !== undefined &&
    salePriceMinor !== null &&
    salePriceMinor >= priceMinor
  ) {
    return { ok: false, reasonCode: 'sale_not_below_price' };
  }

  if (saleStartsAt && saleEndsAt && saleEndsAt <= saleStartsAt) {
    return { ok: false, reasonCode: 'sale_window_inverted' };
  }

  return { ok: true };
}

export const variantInputSchema = z.object({
  sku: skuSchema,
  labelAr: z.string().min(1).max(255).nullable().optional(),
  labelEn: z.string().min(1).max(255).nullable().optional(),
  priceMinor: priceMinorSchema,
  compareAtMinor: priceMinorSchema.nullable().optional(),
  salePriceMinor: priceMinorSchema.nullable().optional(),
  saleStartsAt: z.date().nullable().optional(),
  saleEndsAt: z.date().nullable().optional(),
  stockQuantity: z.number().int().nonnegative().optional(),
  lowStockThreshold: z.number().int().nonnegative().optional(),
  trackInventory: z.boolean().optional(),
  weightGrams: z.number().int().positive().nullable().optional(),
  position: z.number().int().optional(),
  /**
   * For a product with options: which value of each option this variant
   * represents, e.g. `[{ optionNameEn: 'Color', valueEn: 'Black' }, { optionNameEn: 'Size', valueEn: '40' }]`.
   * Omitted (or empty) for a product with no options — the one default
   * variant every simple product has.
   */
  optionValues: z
    .array(z.object({ optionNameEn: z.string().min(1), valueEn: z.string().min(1) }))
    .optional(),
});
export type VariantInput = z.infer<typeof variantInputSchema>;

/** The full shape `createProduct` accepts: core fields, the option matrix
 * (if any), and the variant(s) that matrix produces. */
export const createProductInputSchema = z.object({
  product: productCoreInputSchema,
  options: z.array(productOptionInputSchema).optional(),
  variants: z.array(variantInputSchema).min(1, 'A product needs at least one variant'),
});
export type CreateProductInput = z.infer<typeof createProductInputSchema>;
