import type { HomepageSectionView } from '@/modules/content';
import type { Locale } from '@/lib/i18n/locales';
import { HeroSection } from './hero-section';
import { BannerSection } from './banner-section';
import { FeaturedCategoriesSection } from './featured-categories-section';
import { ProductRailSection } from './product-rail-section';
import { TestimonialsSection } from './testimonials-section';
import { TrustBlocksSection } from './trust-blocks-section';

/** One switch, one place — every `HomepageSectionType` the schema defines
 * has exactly one renderer here. Adding a new type is a compile error in
 * this function until it's handled (the `never` check below), not a
 * silently-blank section in production. */
export function SectionRenderer({
  section,
  locale,
}: {
  section: HomepageSectionView;
  locale: Locale;
}) {
  switch (section.type) {
    case 'HERO':
      return <HeroSection section={section} locale={locale} />;
    case 'BANNER':
    case 'CUSTOM_PROMO':
      return <BannerSection section={section} locale={locale} />;
    case 'FEATURED_CATEGORIES':
      return <FeaturedCategoriesSection section={section} locale={locale} />;
    case 'FEATURED_PRODUCTS':
    case 'NEW_ARRIVALS':
    case 'BEST_SELLERS':
    case 'ACTIVE_OFFERS':
      return <ProductRailSection section={section} locale={locale} />;
    case 'TESTIMONIALS':
      return <TestimonialsSection section={section} locale={locale} />;
    case 'TRUST_BLOCKS':
      return <TrustBlocksSection section={section} locale={locale} />;
    default: {
      const exhaustive: never = section;
      return exhaustive;
    }
  }
}
