import {
  BadgeCheck,
  Clock,
  CreditCard,
  Headphones,
  Lock,
  RotateCcw,
  ShieldCheck,
  Truck,
  type LucideIcon,
} from 'lucide-react';

import type { TrustBlockIcon, TrustBlocksSectionView } from '@/modules/content';
import type { Locale } from '@/lib/i18n/locales';

/** A fixed lookup, matching `content`'s closed `TRUST_BLOCK_ICONS` list —
 * this is the one place a stored icon *name* becomes an actual component,
 * never dynamic/`eval`ed. */
const ICONS: Record<TrustBlockIcon, LucideIcon> = {
  ShieldCheck,
  Truck,
  RotateCcw,
  CreditCard,
  Headphones,
  BadgeCheck,
  Lock,
  Clock,
};

export function TrustBlocksSection({
  section,
  locale,
}: {
  section: TrustBlocksSectionView;
  locale: Locale;
}) {
  const title = locale === 'ar' ? section.titleAr : section.titleEn;

  return (
    <section className="flex flex-col gap-5">
      {title ? <h2 className="text-h3 text-(--color-text)">{title}</h2> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {section.items.map((item, index) => {
          const Icon = ICONS[item.icon];
          return (
            <div
              key={index}
              className="flex flex-col items-start gap-2 rounded-(--radius-surface) p-4"
            >
              <div className="flex size-10 items-center justify-center rounded-(--radius-full) bg-(--color-secondary)">
                <Icon className="size-5 text-(--color-secondary-foreground)" aria-hidden="true" />
              </div>
              <p className="text-sm font-semibold text-(--color-text)">
                {locale === 'ar' ? item.titleAr : item.titleEn}
              </p>
              {(locale === 'ar' ? item.descriptionAr : item.descriptionEn) ? (
                <p className="text-caption text-(--color-text-muted)">
                  {locale === 'ar' ? item.descriptionAr : item.descriptionEn}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
