/**
 * `content` — homepage sections, banners, navigation. A typed section registry, not a page builder.
 *
 * May depend on: core, media, catalog
 * Must not depend on: orders, cart, payments
 *
 * P05 built the storefront read side — `getPublishedHomepageSections()`
 * renders only published, enabled sections (`HomepageSection.config`, never
 * `draftConfig`), with every referenced category/product/media id already
 * resolved.
 *
 * P15 adds the admin write side the Content screen edits it through:
 * create, edit, reorder, enable/disable, draft and publish. The two halves
 * meet at the same two columns and nowhere else — the read side still never
 * touches `draftConfig`, so an unpublished edit has no path to a visitor.
 *
 * Other modules import `@/modules/content`, never a file inside it.
 */

export {
  getPublishedHomepageSections,
  buildFallbackHomepageSections,
  TRUST_BLOCK_ICONS,
  type HomepageSectionView,
  type HeroSectionView,
  type BannerSectionView,
  type FeaturedCategoriesSectionView,
  type ProductRailSectionView,
  type TestimonialsSectionView,
  type TrustBlocksSectionView,
  type TrustBlockIcon,
  type CustomPromoSectionView,
} from './homepage.service';

export { sectionConfigSchemas, type SectionConfig } from './section-schemas';

/** Admin (P15) — the authoring side of the same rows. */
export {
  listHomepageSections,
  getHomepageSection,
  createHomepageSection,
  updateHomepageSectionConfig,
  publishHomepageSectionDraft,
  discardHomepageSectionDraft,
  setHomepageSectionEnabled,
  deleteHomepageSection,
  reorderHomepageSections,
  getSectionHeadline,
  type HomepageSectionRecord,
  type CreateHomepageSectionInput,
} from './section-admin.service';
