import { db } from '@/modules/core';
import { getMediaAsset, toImageProp, type ResolvedMediaImage } from '@/modules/media';
import { listProducts, type ProductListingItem } from '@/modules/catalog';

import { sectionConfigSchemas, type SectionConfig } from './section-schemas';

/**
 * The storefront's one read path for the homepage: every published,
 * enabled section, in order, with every category/product/media id already
 * resolved into real data. `HomepageSection.draftConfig` never reaches this
 * function — only `config`, the published state (ADR-014) — so there is no
 * code path by which an unpublished edit could leak to a public visitor.
 *
 * A section whose stored `config` no longer matches its type's schema (a
 * future admin CMS's bug, a hand-edited row, a type change without a
 * migration) is skipped with a logged warning rather than throwing — one
 * malformed section must never take the whole homepage down.
 */

export interface ProductRailSectionView {
  id: string;
  type: 'FEATURED_PRODUCTS' | 'NEW_ARRIVALS' | 'BEST_SELLERS' | 'ACTIVE_OFFERS';
  titleAr: string | null;
  titleEn: string | null;
  products: ProductListingItem[];
}

export interface HeroSectionView {
  id: string;
  type: 'HERO';
  titleAr: string;
  titleEn: string;
  subtitleAr: string | null;
  subtitleEn: string | null;
  ctaLabelAr: string | null;
  ctaLabelEn: string | null;
  ctaHref: string | null;
  image: ResolvedMediaImage | null;
}

export interface BannerSectionView {
  id: string;
  type: 'BANNER';
  titleAr: string;
  titleEn: string;
  subtitleAr: string | null;
  subtitleEn: string | null;
  ctaLabelAr: string | null;
  ctaLabelEn: string | null;
  ctaHref: string | null;
  image: ResolvedMediaImage | null;
  tone: 'brand' | 'accent' | 'neutral';
}

export interface FeaturedCategoriesSectionView {
  id: string;
  type: 'FEATURED_CATEGORIES';
  titleAr: string | null;
  titleEn: string | null;
  categories: {
    id: string;
    slug: string;
    nameAr: string;
    nameEn: string;
    image: ResolvedMediaImage | null;
  }[];
}

export interface TestimonialsSectionView {
  id: string;
  type: 'TESTIMONIALS';
  titleAr: string | null;
  titleEn: string | null;
  items: {
    authorName: string;
    authorTitleAr: string | null;
    authorTitleEn: string | null;
    quoteAr: string;
    quoteEn: string;
    rating: number | null;
  }[];
}

/** A small, closed allow-list rather than an arbitrary string rendered as a
 * component name — stored config can only ever pick one of these. */
export const TRUST_BLOCK_ICONS = [
  'ShieldCheck',
  'Truck',
  'RotateCcw',
  'CreditCard',
  'Headphones',
  'BadgeCheck',
  'Lock',
  'Clock',
] as const;
export type TrustBlockIcon = (typeof TRUST_BLOCK_ICONS)[number];

export interface TrustBlocksSectionView {
  id: string;
  type: 'TRUST_BLOCKS';
  titleAr: string | null;
  titleEn: string | null;
  items: {
    icon: TrustBlockIcon;
    titleAr: string;
    titleEn: string;
    descriptionAr: string | null;
    descriptionEn: string | null;
  }[];
}

export interface CustomPromoSectionView {
  id: string;
  type: 'CUSTOM_PROMO';
  titleAr: string;
  titleEn: string;
  bodyAr: string | null;
  bodyEn: string | null;
  ctaLabelAr: string | null;
  ctaLabelEn: string | null;
  ctaHref: string | null;
  image: ResolvedMediaImage | null;
  tone: 'brand' | 'accent' | 'neutral';
}

export type HomepageSectionView =
  | HeroSectionView
  | BannerSectionView
  | FeaturedCategoriesSectionView
  | ProductRailSectionView
  | TestimonialsSectionView
  | TrustBlocksSectionView
  | CustomPromoSectionView;

async function resolveImage(
  mediaId: string | undefined,
  locale: 'ar' | 'en',
): Promise<ResolvedMediaImage | null> {
  if (!mediaId) return null;
  const asset = await getMediaAsset(mediaId);
  return asset ? toImageProp(asset, locale) : null;
}

async function resolveProducts(
  productIds: string[],
  type: ProductRailSectionView['type'],
  locale: 'ar' | 'en',
): Promise<ProductListingItem[]> {
  const result = await listProducts({ productIds, pageSize: productIds.length }, locale);
  // A curated id may reference a product that's since been unpublished or
  // deleted — `listProducts` already only returns published ones, so this
  // is just "fewer items than curated," never a broken reference rendered.
  if (type !== 'ACTIVE_OFFERS') return result.items;
  // Stale curation: a product that isn't on sale *right now* doesn't belong
  // in an "active offers" rail even if it was picked while it was.
  return result.items.filter((item) => item.price.onSale);
}

function resolveTrustIcon(icon: string): TrustBlockIcon {
  return (TRUST_BLOCK_ICONS as readonly string[]).includes(icon)
    ? (icon as TrustBlockIcon)
    : 'BadgeCheck';
}

export async function getPublishedHomepageSections(
  locale: 'ar' | 'en' = 'ar',
): Promise<HomepageSectionView[]> {
  const rows = await db.homepageSection.findMany({
    where: { enabled: true },
    orderBy: { position: 'asc' },
  });

  const views: HomepageSectionView[] = [];

  for (const row of rows) {
    const schema = sectionConfigSchemas[row.type];
    const parsed = schema.safeParse(row.config);
    if (!parsed.success) {
      // Server-side diagnostic only — never thrown to the visitor.
      console.warn(
        `[content] Skipping homepage section ${row.id} (${row.type}): invalid config`,
        parsed.error.issues,
      );
      continue;
    }
    const config = parsed.data;

    switch (row.type) {
      case 'HERO': {
        const c = config as SectionConfig['HERO'];
        views.push({
          id: row.id,
          type: 'HERO',
          titleAr: c.titleAr,
          titleEn: c.titleEn,
          subtitleAr: c.subtitleAr ?? null,
          subtitleEn: c.subtitleEn ?? null,
          ctaLabelAr: c.ctaLabelAr ?? null,
          ctaLabelEn: c.ctaLabelEn ?? null,
          ctaHref: c.ctaHref ?? null,
          image: await resolveImage(c.imageMediaId, locale),
        });
        break;
      }
      case 'BANNER': {
        const c = config as SectionConfig['BANNER'];
        views.push({
          id: row.id,
          type: 'BANNER',
          titleAr: c.titleAr,
          titleEn: c.titleEn,
          subtitleAr: c.subtitleAr ?? null,
          subtitleEn: c.subtitleEn ?? null,
          ctaLabelAr: c.ctaLabelAr ?? null,
          ctaLabelEn: c.ctaLabelEn ?? null,
          ctaHref: c.ctaHref ?? null,
          image: await resolveImage(c.imageMediaId, locale),
          tone: c.tone,
        });
        break;
      }
      case 'FEATURED_CATEGORIES': {
        const c = config as SectionConfig['FEATURED_CATEGORIES'];
        const rowsById = new Map(
          (await db.category.findMany({ where: { id: { in: c.categoryIds } } })).map((cat) => [
            cat.id,
            cat,
          ]),
        );
        const categories = await Promise.all(
          c.categoryIds
            .map((id) => rowsById.get(id))
            .filter((cat): cat is NonNullable<typeof cat> => Boolean(cat))
            .map(async (cat) => ({
              id: cat.id,
              slug: cat.slug,
              nameAr: cat.nameAr,
              nameEn: cat.nameEn,
              image: cat.imageMediaId ? await resolveImage(cat.imageMediaId, locale) : null,
            })),
        );
        views.push({
          id: row.id,
          type: 'FEATURED_CATEGORIES',
          titleAr: c.titleAr ?? null,
          titleEn: c.titleEn ?? null,
          categories,
        });
        break;
      }
      case 'FEATURED_PRODUCTS':
      case 'BEST_SELLERS':
      case 'ACTIVE_OFFERS': {
        const c = config as SectionConfig['FEATURED_PRODUCTS'];
        views.push({
          id: row.id,
          type: row.type,
          titleAr: c.titleAr ?? null,
          titleEn: c.titleEn ?? null,
          products: await resolveProducts(c.productIds, row.type, locale),
        });
        break;
      }
      case 'NEW_ARRIVALS': {
        const c = config as SectionConfig['NEW_ARRIVALS'];
        const result = await listProducts(
          { categoryId: c.categoryId, sort: 'newest', pageSize: c.limit },
          locale,
        );
        views.push({
          id: row.id,
          type: 'NEW_ARRIVALS',
          titleAr: c.titleAr ?? null,
          titleEn: c.titleEn ?? null,
          products: result.items,
        });
        break;
      }
      case 'TESTIMONIALS': {
        const c = config as SectionConfig['TESTIMONIALS'];
        views.push({
          id: row.id,
          type: 'TESTIMONIALS',
          titleAr: c.titleAr ?? null,
          titleEn: c.titleEn ?? null,
          items: c.items.map((item) => ({
            authorName: item.authorName,
            authorTitleAr: item.authorTitleAr ?? null,
            authorTitleEn: item.authorTitleEn ?? null,
            quoteAr: item.quoteAr,
            quoteEn: item.quoteEn,
            rating: item.rating ?? null,
          })),
        });
        break;
      }
      case 'TRUST_BLOCKS': {
        const c = config as SectionConfig['TRUST_BLOCKS'];
        views.push({
          id: row.id,
          type: 'TRUST_BLOCKS',
          titleAr: c.titleAr ?? null,
          titleEn: c.titleEn ?? null,
          items: c.items.map((item) => ({
            icon: resolveTrustIcon(item.icon),
            titleAr: item.titleAr,
            titleEn: item.titleEn,
            descriptionAr: item.descriptionAr ?? null,
            descriptionEn: item.descriptionEn ?? null,
          })),
        });
        break;
      }
      case 'CUSTOM_PROMO': {
        const c = config as SectionConfig['CUSTOM_PROMO'];
        views.push({
          id: row.id,
          type: 'CUSTOM_PROMO',
          titleAr: c.titleAr,
          titleEn: c.titleEn,
          bodyAr: c.bodyAr ?? null,
          bodyEn: c.bodyEn ?? null,
          ctaLabelAr: c.ctaLabelAr ?? null,
          ctaLabelEn: c.ctaLabelEn ?? null,
          ctaHref: c.ctaHref ?? null,
          image: await resolveImage(c.imageMediaId, locale),
          tone: c.tone,
        });
        break;
      }
    }
  }

  return views;
}

/**
 * What the homepage shows when the store owner has not built one yet.
 *
 * A store with published products used to greet its customers with "no
 * homepage content has been published yet" — an admin's problem, phrased at
 * the shopper, on the one page that decides whether they stay. The owner
 * can now build a real homepage at `/admin/content`, but until they do,
 * showing them their own products is both truer and more useful than
 * showing them a notice.
 *
 * These are synthesized views, not stored rows: nothing is written, the
 * admin's Content screen stays empty (because it *is* empty), and the
 * moment a real section is published this stops being used. So it is a
 * fallback, never a hidden default the owner cannot see or change.
 *
 * If the store genuinely has nothing published, this returns nothing and
 * the honest empty state stands.
 */
const FALLBACK_PRODUCT_LIMIT = 8;

export async function buildFallbackHomepageSections(
  locale: 'ar' | 'en' = 'ar',
): Promise<HomepageSectionView[]> {
  const [newest, categoryRows] = await Promise.all([
    listProducts({ sort: 'newest', pageSize: FALLBACK_PRODUCT_LIMIT }, locale),
    db.category.findMany({ orderBy: { position: 'asc' } }),
  ]);

  if (newest.items.length === 0) return [];

  const sections: HomepageSectionView[] = [
    {
      id: 'fallback-new-arrivals',
      type: 'NEW_ARRIVALS',
      titleAr: 'أحدث المنتجات',
      titleEn: 'Latest products',
      products: newest.items,
    },
  ];

  // One category is not a choice worth rendering a grid for — it would just
  // repeat the link already in the header.
  if (categoryRows.length > 1) {
    sections.push({
      id: 'fallback-categories',
      type: 'FEATURED_CATEGORIES',
      titleAr: 'تسوّق حسب الفئة',
      titleEn: 'Shop by category',
      categories: await Promise.all(
        categoryRows.map(async (category) => ({
          id: category.id,
          slug: category.slug,
          nameAr: category.nameAr,
          nameEn: category.nameEn,
          image: category.imageMediaId ? await resolveImage(category.imageMediaId, locale) : null,
        })),
      ),
    });
  }

  return sections;
}
