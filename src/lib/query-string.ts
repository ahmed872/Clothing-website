/**
 * Applies a patch to a `URLSearchParams`-compatible query string, returning
 * the new string — the one place every listing control (sort, filters,
 * pagination) builds the URL it navigates to, so they never disagree on how
 * a param is added, replaced, or removed.
 *
 * `undefined`/`null`/`''` deletes the key; changing anything other than
 * `page` itself resets pagination back to page 1 — a new filter or sort
 * order showing "page 4 of 1" would be a bug, not a feature.
 */
export function withQueryPatch(
  currentSearch: string | URLSearchParams,
  patch: Record<string, string | string[] | undefined | null>,
): string {
  const params = new URLSearchParams(currentSearch);
  const resetsPage = Object.keys(patch).some((key) => key !== 'page');

  for (const [key, value] of Object.entries(patch)) {
    params.delete(key);
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      params.set(key, value.join(','));
    } else {
      params.set(key, value);
    }
  }

  if (resetsPage && !('page' in patch)) params.delete('page');

  return params.toString();
}
