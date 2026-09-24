import { AppError } from '@/modules/core';

/** Same pattern as `catalog/prisma-errors.ts` — Prisma's unique-violation
 * code, turned into the platform's one error type. */
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
      // Field-specific `reasonCode` (`duplicate_email`), matching
      // `catalog/prisma-errors.ts`. Without it `adminErrorMessage` falls
      // back to `CONFLICT`'s generic "this item changed somewhere else,
      // refresh and try again" text — which is what a stale-version
      // conflict says and reads as actively misleading when what actually
      // happened is that the email is already taken. Nothing surfaced this
      // through a UI until the staff screen (P14 §B): `createUser`'s only
      // caller before that was the bootstrap script, which prints the raw
      // error.
      details: { field, reasonCode: `duplicate_${field}` },
      internalMessage: `${field} already exists`,
    });
  }
  return error instanceof AppError ? error : new AppError('INTERNAL', { cause: error });
}
