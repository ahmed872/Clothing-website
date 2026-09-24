import { z } from 'zod';

/**
 * Slugs are the one identifier a customer sees in a URL, so they follow one
 * rule regardless of script: lowercase-normalised (a no-op for Arabic, which
 * has no case), Unicode letters/numbers only, single hyphens between
 * segments. Arabic and Latin slugs are equally valid — the schema stores one
 * `slug` per entity (ADR: no per-locale slug column), and which script a
 * store uses for it is a content decision, not one this module makes.
 */
const SLUG_PATTERN = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;

export const slugSchema = z
  .string()
  .min(1, 'Slug is required')
  .max(160, 'Slug must be 160 characters or fewer')
  .regex(
    SLUG_PATTERN,
    'Slug must be lowercase, URL-safe, and hyphen-separated (no spaces or punctuation)',
  )
  // The character class alone accepts uppercase Latin letters too (case is
  // meaningless to \p{L}); comparing against `toLowerCase()` is the actual
  // lowercase check, and a no-op for Arabic, which has no case to compare.
  .refine((value) => value === value.toLowerCase(), 'Slug must be lowercase');

/** Derives a URL-safe slug from free text. Not injective — callers that need
 * uniqueness (every catalog entity does) must still handle a collision. */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Appends a numeric suffix until `exists` reports the candidate is free.
 * Used by callers (the migration script, admin "create" flows) that derive a
 * slug from a name rather than accepting one typed by a person.
 */
export async function ensureUniqueSlug(
  base: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const root = slugify(base) || 'item';
  let candidate = root;
  let suffix = 2;
  while (await exists(candidate)) {
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}
