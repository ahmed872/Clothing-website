import { z } from 'zod';

/**
 * What an admin may set on a promotion, validated on the server (P09 §12).
 * The UI's own constraints are a convenience; these are the rules.
 */

/**
 * Codes are normalised, not merely trimmed: a customer typing `welcome10`,
 * ` Welcome10 ` or `WELCOME10` is entering the same promotion, and the
 * column is unique — so the value that reaches the database has to be the
 * canonical one, in both the admin form and the cart.
 */
export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export const couponCodeSchema = z
  .string()
  .min(3, 'A code needs at least 3 characters')
  .max(40)
  .transform(normalizeCouponCode)
  .refine((code) => /^[A-Z0-9][A-Z0-9_-]*$/.test(code), {
    message: 'A code may contain letters, digits, hyphens and underscores only',
  });

export const couponTypeSchema = z.enum(['PERCENTAGE', 'FIXED']);
export const couponScopeTypeSchema = z.enum(['PRODUCT', 'CATEGORY', 'BRAND']);

/** Money in minor units, as everywhere else (ADR-006/ADR-022). */
const minorSchema = z.number().int().nonnegative().max(1_000_000_000);

export const couponScopeInputSchema = z.object({
  scopeType: couponScopeTypeSchema,
  targetId: z.string().uuid(),
});

export const couponInputSchema = z
  .object({
    code: couponCodeSchema,
    type: couponTypeSchema,
    /**
     * Percentage points for PERCENTAGE, minor units for FIXED — the column
     * is a single `Int`, so a percentage is a whole number. Fractional
     * percentages are deliberately not supported: representing them would
     * need a schema change, and every rounding question they raise is one
     * more way for a total to disagree with itself.
     */
    value: z.number().int().positive(),
    descriptionAr: z.string().max(500).nullable().optional(),
    descriptionEn: z.string().max(500).nullable().optional(),
    minOrderMinor: minorSchema.nullable().optional(),
    maxDiscountMinor: minorSchema.positive().nullable().optional(),
    usageLimit: z.number().int().positive().nullable().optional(),
    perCustomerLimit: z.number().int().positive().nullable().optional(),
    startsAt: z.date().nullable().optional(),
    endsAt: z.date().nullable().optional(),
    active: z.boolean().optional(),
    scopes: z.array(couponScopeInputSchema).max(200).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'PERCENTAGE' && value.value > 100) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'A percentage discount cannot exceed 100%',
      });
    }
    if (value.startsAt && value.endsAt && value.startsAt >= value.endsAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'The promotion must start before it ends',
      });
    }
    // A ceiling on a fixed-amount coupon is contradictory: the amount is
    // already the ceiling, and two competing limits is one too many.
    if (value.type === 'FIXED' && value.maxDiscountMinor != null) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxDiscountMinor'],
        message: 'A maximum discount applies to percentage promotions only',
      });
    }
  });

export type CouponInput = z.infer<typeof couponInputSchema>;
export type CouponScopeInput = z.infer<typeof couponScopeInputSchema>;

export const couponUpdateSchema = couponInputSchema;
