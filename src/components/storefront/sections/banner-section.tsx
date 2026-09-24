import Link from 'next/link';

import type { BannerSectionView, CustomPromoSectionView } from '@/modules/content';
import { localizeHref, type Locale } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SafeImage } from '@/components/storefront/safe-image';

const TONE_CLASSES: Record<'brand' | 'accent' | 'neutral', string> = {
  brand: 'bg-(--color-brand) text-(--color-brand-foreground)',
  accent: 'bg-(--color-accent) text-(--color-accent-foreground)',
  neutral: 'bg-(--color-surface-raised) text-(--color-text)',
};

/** Shared by BANNER and CUSTOM_PROMO — both are "a titled promo strip with
 * an optional image and CTA," just with slightly different config shapes. */
export function BannerSection({
  section,
  locale,
}: {
  section: BannerSectionView | CustomPromoSectionView;
  locale: Locale;
}) {
  const title = locale === 'ar' ? section.titleAr : section.titleEn;
  const subtitle =
    'subtitleAr' in section
      ? locale === 'ar'
        ? section.subtitleAr
        : section.subtitleEn
      : locale === 'ar'
        ? section.bodyAr
        : section.bodyEn;
  const ctaLabel = locale === 'ar' ? section.ctaLabelAr : section.ctaLabelEn;

  return (
    <section
      className={cn(
        'flex flex-col items-start gap-4 overflow-hidden rounded-(--radius-lg) px-6 py-10 sm:px-10',
        'sm:flex-row sm:items-center sm:justify-between',
        TONE_CLASSES[section.tone],
      )}
    >
      <div className="flex flex-col items-start gap-2 text-start">
        <h2 className="text-h3">{title}</h2>
        {subtitle ? <p className="max-w-lg opacity-90">{subtitle}</p> : null}
      </div>

      <div className="flex shrink-0 items-center gap-4">
        {section.image ? (
          <div className="relative hidden size-24 overflow-hidden rounded-(--radius-surface) sm:block">
            <SafeImage
              src={section.image.src}
              alt={section.image.alt}
              fill
              sizes="96px"
              className="object-cover"
            />
          </div>
        ) : null}
        {ctaLabel && section.ctaHref ? (
          <Button asChild variant="secondary" size="lg">
            <Link href={localizeHref(section.ctaHref, locale)}>{ctaLabel}</Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
