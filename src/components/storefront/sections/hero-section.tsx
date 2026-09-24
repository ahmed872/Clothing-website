import Link from 'next/link';

import type { HeroSectionView } from '@/modules/content';
import { localizeHref, type Locale } from '@/lib/i18n/locales';
import { Button } from '@/components/ui/button';
import { SafeImage } from '@/components/storefront/safe-image';

export function HeroSection({ section, locale }: { section: HeroSectionView; locale: Locale }) {
  const title = locale === 'ar' ? section.titleAr : section.titleEn;
  const subtitle = locale === 'ar' ? section.subtitleAr : section.subtitleEn;
  const ctaLabel = locale === 'ar' ? section.ctaLabelAr : section.ctaLabelEn;

  return (
    <section className="relative overflow-hidden rounded-(--radius-lg) bg-(--color-surface-raised)">
      <div className="relative grid gap-6 px-6 py-12 sm:px-10 sm:py-16 md:grid-cols-2 md:items-center md:py-20">
        <div className="flex flex-col items-start gap-4 text-start">
          <h1 className="text-display text-(--color-text)">{title}</h1>
          {subtitle ? (
            <p className="max-w-md text-body text-(--color-text-muted)">{subtitle}</p>
          ) : null}
          {ctaLabel && section.ctaHref ? (
            <Button asChild size="lg" className="mt-2">
              <Link href={localizeHref(section.ctaHref, locale)}>{ctaLabel}</Link>
            </Button>
          ) : null}
        </div>

        {section.image ? (
          <div className="relative aspect-4/3 w-full overflow-hidden rounded-(--radius-surface) md:aspect-square">
            <SafeImage
              src={section.image.src}
              alt={section.image.alt}
              fill
              priority
              sizes="(min-width: 768px) 45vw, 100vw"
              className="object-cover"
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
