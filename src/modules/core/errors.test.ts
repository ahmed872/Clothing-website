import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppError, ERROR_CODES, isAppError, toAppError } from './errors';

describe('AppError', () => {
  it('carries a stable code and an HTTP status', () => {
    const error = new AppError('OUT_OF_STOCK');
    expect(error.code).toBe('OUT_OF_STOCK');
    expect(error.httpStatus).toBe(409);
    expect(isAppError(error)).toBe(true);
  });

  it('gives every code a message in both languages', () => {
    for (const code of ERROR_CODES) {
      const error = new AppError(code);
      expect(error.messageFor('ar').length).toBeGreaterThan(0);
      expect(error.messageFor('en').length).toBeGreaterThan(0);
      // Arabic messages must actually be Arabic, not a copied English string.
      expect(error.messageFor('ar')).toMatch(/[؀-ۿ]/);
    }
  });

  it('keeps the original failure as cause without exposing it to the user', () => {
    const cause = new Error('connection refused at 10.0.0.5:5432');
    const error = new AppError('INTERNAL', { cause });
    expect(error.cause).toBe(cause);
    expect(error.messageFor('en')).not.toContain('10.0.0.5');
  });
});

describe('toAppError', () => {
  it('passes an AppError through unchanged', () => {
    const original = new AppError('FORBIDDEN');
    expect(toAppError(original)).toBe(original);
  });

  it('wraps an unknown throw as INTERNAL and keeps the cause', () => {
    const raw = new Error('kaboom');
    const wrapped = toAppError(raw);
    expect(wrapped.code).toBe('INTERNAL');
    expect(wrapped.httpStatus).toBe(500);
    expect(wrapped.cause).toBe(raw);
  });

  it('handles non-Error throws', () => {
    expect(toAppError('a string').code).toBe('INTERNAL');
    expect(toAppError(undefined).code).toBe('INTERNAL');
  });

  it('maps a ZodError to VALIDATION_FAILED (422), not INTERNAL', () => {
    const schema = z.object({ slug: z.string().min(1) });
    const result = schema.safeParse({ slug: '' });
    if (result.success) throw new Error('expected the schema to fail');

    const wrapped = toAppError(result.error);
    expect(wrapped.code).toBe('VALIDATION_FAILED');
    expect(wrapped.httpStatus).toBe(422);
    expect(wrapped.details?.issues).toBeDefined();
  });
});
