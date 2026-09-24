import { AppError } from '@/modules/core';

/**
 * Prisma's unique-violation code (P2002), turned into the platform's one
 * error type, so a caller never needs to know a database driver is involved.
 * Shared across every catalog service that has a unique column (slug, SKU,
 * category+key, …).
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export function mapUniqueConstraint(error: unknown, field: string): AppError {
  if (isUniqueConstraintError(error)) {
    return new AppError('CONFLICT', {
      cause: error,
      // `reasonCode` is field-specific (`duplicate_slug`, `duplicate_sku`, …)
      // so `adminErrorMessage` can say exactly what's duplicated instead of
      // falling back to `CONFLICT`'s generic "this item changed somewhere
      // else" text — which is what a stale-version conflict says, and reads
      // as actively misleading on a plain duplicate-value rejection.
      details: { field, reasonCode: `duplicate_${field}` },
      internalMessage: `${field} already exists`,
    });
  }
  return error instanceof AppError ? error : new AppError('INTERNAL', { cause: error });
}

/** Prisma's `onDelete: Restrict` violation (P2003) — the database itself
 * refusing a delete because another row still references it (a cart item or
 * inventory adjustment still pointing at a variant, a product still
 * assigned to a brand, …). Turned into a `CONFLICT` with a reason a person
 * can act on, the same "never leak a raw driver error" rule
 * `mapUniqueConstraint` already follows. */
export function isForeignKeyRestrictError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2003'
  );
}

/** `reasonCode` is a fixed, locale-free slug (e.g. `'category_still_referenced'`)
 * — the admin UI's `admin-dictionary.ts` `errors` section turns it into an
 * actual bilingual sentence; this file has no business writing UI copy in
 * any language. */
export function mapForeignKeyRestrict(error: unknown, reasonCode: string): AppError {
  if (isForeignKeyRestrictError(error)) {
    return new AppError('CONFLICT', {
      cause: error,
      details: { reasonCode },
      internalMessage: reasonCode,
    });
  }
  return error instanceof AppError ? error : new AppError('INTERNAL', { cause: error });
}
