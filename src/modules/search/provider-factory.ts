import { postgresSearchProvider } from './postgres-provider';
import type { SearchProvider } from './provider';

/**
 * The single seam a future search engine (Meilisearch, Typesense, Algolia)
 * plugs into: implement `SearchProvider` in a new file and return it here
 * instead. No env-driven switch yet — unlike `media`'s `STORAGE_PROVIDER`,
 * there is only one real, tested implementation right now, and a `'meilisearch'`
 * option that didn't actually talk to anything would be exactly the kind of
 * fake-it-until-you-make-it P04's media work explicitly ruled out. Add the
 * switch when a second real provider exists, not before.
 */
export function getSearchProvider(): SearchProvider {
  return postgresSearchProvider;
}
