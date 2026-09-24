/**
 * Client-side live preview only — mirrors `catalog/slug.ts#slugify`'s
 * output closely enough to preview as an admin types, but it is not the
 * business rule. Every create/update call still validates the real slug
 * server-side through `catalog`'s own `slugSchema`/`ensureUniqueSlug` (the
 * one place uniqueness can actually be checked); this never substitutes
 * for that. Duplicated rather than imported from `@/modules/catalog`
 * because that barrel pulls in server-only code (`db`, `server-only`
 * guards) that a client bundle must never touch.
 */
export function previewSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
