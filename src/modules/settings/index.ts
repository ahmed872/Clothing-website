/**
 * `settings` — store settings, branding, shipping and notification configuration.
 *
 * May depend on: core, media
 * Must not depend on: every domain module
 *
 * P05 built the read side — `getStoreSettings()`, the single source of
 * truth for store name, currency, branding and SEO defaults across the
 * storefront. P15 adds the write side the admin Settings screen edits it
 * through: the raw row (`getStoreSettingsRecord`), its validation schema,
 * and one guarded update.
 *
 * Other modules import `@/modules/settings`, never a file inside it.
 */

export { getStoreSettings, type StoreSettingsView } from './store-settings.service';

/** Admin (P15) — the editing side of the same single row. */
export {
  getStoreSettingsRecord,
  updateStoreSettings,
  storeSettingsInputSchema,
  SOCIAL_LINK_KEYS,
  type StoreSettingsRecord,
  type StoreSettingsInput,
  type SocialLinkKey,
} from './store-settings.service';
