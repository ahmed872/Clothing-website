import type { ProductDetailAttribute } from '@/modules/catalog';
import type { Locale } from '@/lib/i18n/locales';
import { attributeValueLabel } from '@/lib/attribute-value-label';

function formatValue(spec: ProductDetailAttribute, locale: Locale): string {
  const { value, unit } = spec;
  const label = (v: unknown) => attributeValueLabel(spec.valueLabels, String(v), locale);
  if (Array.isArray(value)) return value.map(label).join(locale === 'ar' ? '، ' : ', ');
  if (typeof value === 'boolean') return value ? '✓' : '—';
  return unit ? `${value} ${unit}` : label(value);
}

/** Category-defined attributes only — nothing here is specific to any one
 * kind of product; a category with no attribute definitions simply has no
 * specifications table. */
export function SpecificationsTable({
  specifications,
  locale,
}: {
  specifications: ProductDetailAttribute[];
  locale: Locale;
}) {
  if (specifications.length === 0) return null;

  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
      {specifications.map((spec) => (
        <div
          key={spec.key}
          className="flex items-baseline justify-between gap-4 border-b border-(--color-border) pb-2"
        >
          <dt className="text-small text-(--color-text-muted)">
            {locale === 'ar' ? spec.labelAr : spec.labelEn}
          </dt>
          <dd className="text-small font-medium text-(--color-text)">
            {formatValue(spec, locale)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
