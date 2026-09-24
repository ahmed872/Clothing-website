import { z } from 'zod';

/**
 * One Zod schema per `HomepageSectionType`, validating the shape of a
 * `HomepageSection.config` JSON blob — the raw, admin-authored (future
 * phase) form, before any category/product/media id gets resolved into real
 * data. Every schema is deliberately generic: nothing here mentions cars,
 * shoes, or any other kind of product.
 */

const heroSchema = z.object({
  titleAr: z.string().min(1),
  titleEn: z.string().min(1),
  subtitleAr: z.string().optional(),
  subtitleEn: z.string().optional(),
  ctaLabelAr: z.string().optional(),
  ctaLabelEn: z.string().optional(),
  ctaHref: z.string().optional(),
  imageMediaId: z.string().uuid().optional(),
});

const bannerSchema = z.object({
  titleAr: z.string().min(1),
  titleEn: z.string().min(1),
  subtitleAr: z.string().optional(),
  subtitleEn: z.string().optional(),
  ctaLabelAr: z.string().optional(),
  ctaLabelEn: z.string().optional(),
  ctaHref: z.string().optional(),
  imageMediaId: z.string().uuid().optional(),
  tone: z.enum(['brand', 'accent', 'neutral']).default('brand'),
});

const featuredCategoriesSchema = z.object({
  titleAr: z.string().optional(),
  titleEn: z.string().optional(),
  categoryIds: z.array(z.string().uuid()).min(1),
});

const featuredProductsSchema = z.object({
  titleAr: z.string().optional(),
  titleEn: z.string().optional(),
  productIds: z.array(z.string().uuid()).min(1),
});

/** No explicit `productIds`: this rail is always "newest published, in an
 * optional category", computed at render time — a curated pick belongs in
 * `FEATURED_PRODUCTS` instead. */
const newArrivalsSchema = z.object({
  titleAr: z.string().optional(),
  titleEn: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(24).default(8),
});

/**
 * Best sellers, honestly: there is no order/sales-history data yet (`orders`
 * is a later phase), so this section only ever renders a curated
 * `productIds` list, exactly like `FEATURED_PRODUCTS` — it is never computed
 * from real sales figures that don't exist. A store owner picks what to
 * show here today; a future phase can compute it automatically without
 * this config shape changing.
 */
const bestSellersSchema = z.object({
  titleAr: z.string().optional(),
  titleEn: z.string().optional(),
  productIds: z.array(z.string().uuid()).min(1),
});

const activeOffersSchema = z.object({
  titleAr: z.string().optional(),
  titleEn: z.string().optional(),
  productIds: z.array(z.string().uuid()).min(1),
});

const testimonialItemSchema = z.object({
  authorName: z.string().min(1),
  authorTitleAr: z.string().optional(),
  authorTitleEn: z.string().optional(),
  quoteAr: z.string().min(1),
  quoteEn: z.string().min(1),
  rating: z.number().min(1).max(5).optional(),
});

const testimonialsSchema = z.object({
  titleAr: z.string().optional(),
  titleEn: z.string().optional(),
  items: z.array(testimonialItemSchema).min(1),
});

const trustBlockItemSchema = z.object({
  /** A `lucide-react` icon name (e.g. `"Truck"`, `"ShieldCheck"`) — the
   * renderer resolves it from a small fixed allow-list, never `eval`s a
   * component name from stored JSON. */
  icon: z.string().min(1),
  titleAr: z.string().min(1),
  titleEn: z.string().min(1),
  descriptionAr: z.string().optional(),
  descriptionEn: z.string().optional(),
});

const trustBlocksSchema = z.object({
  titleAr: z.string().optional(),
  titleEn: z.string().optional(),
  items: z.array(trustBlockItemSchema).min(1),
});

const customPromoSchema = z.object({
  titleAr: z.string().min(1),
  titleEn: z.string().min(1),
  bodyAr: z.string().optional(),
  bodyEn: z.string().optional(),
  ctaLabelAr: z.string().optional(),
  ctaLabelEn: z.string().optional(),
  ctaHref: z.string().optional(),
  imageMediaId: z.string().uuid().optional(),
  tone: z.enum(['brand', 'accent', 'neutral']).default('brand'),
});

export const sectionConfigSchemas = {
  HERO: heroSchema,
  BANNER: bannerSchema,
  FEATURED_CATEGORIES: featuredCategoriesSchema,
  FEATURED_PRODUCTS: featuredProductsSchema,
  NEW_ARRIVALS: newArrivalsSchema,
  BEST_SELLERS: bestSellersSchema,
  ACTIVE_OFFERS: activeOffersSchema,
  TESTIMONIALS: testimonialsSchema,
  TRUST_BLOCKS: trustBlocksSchema,
  CUSTOM_PROMO: customPromoSchema,
} as const;

export type SectionConfig = {
  [K in keyof typeof sectionConfigSchemas]: z.infer<(typeof sectionConfigSchemas)[K]>;
};
