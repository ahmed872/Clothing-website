import type { Locale } from '../gallery-shell';
import { SectionHeading, SubHeading } from './section-heading';

const COLOR_GROUPS: { label: { ar: string; en: string }; tokens: string[] }[] = [
  {
    label: { ar: 'السطوح', en: 'Surfaces' },
    tokens: ['background', 'surface', 'surface-raised', 'elevated', 'muted'],
  },
  {
    label: { ar: 'الحدود والنص', en: 'Border & text' },
    tokens: ['border', 'border-strong', 'text', 'text-muted', 'text-subtle'],
  },
  {
    label: { ar: 'العلامة التجارية', en: 'Brand' },
    tokens: ['brand', 'brand-hover', 'brand-active', 'primary', 'secondary', 'accent'],
  },
  {
    label: { ar: 'الحالة', en: 'Status' },
    tokens: ['success', 'warning', 'error', 'info'],
  },
];

function ColorSwatch({ token }: { token: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-14 rounded-(--radius-control) border border-(--color-border)"
        style={{ backgroundColor: `var(--color-${token})` }}
      />
      <code className="text-caption text-(--color-text-muted)">--color-{token}</code>
    </div>
  );
}

// Tailwind's build-time scanner needs literal class names — a template
// string like `text-${key}` is invisible to it, so every scale step spells
// its class out in full rather than being assembled from `key`.
const TYPE_SCALE: { label: string; className: string }[] = [
  { label: 'Display', className: 'text-display' },
  { label: 'H1', className: 'text-h1' },
  { label: 'H2', className: 'text-h2' },
  { label: 'H3', className: 'text-h3' },
  { label: 'H4', className: 'text-h4' },
  { label: 'H5', className: 'text-h5' },
  { label: 'H6', className: 'text-h6' },
  { label: 'Body', className: 'text-body' },
  { label: 'Small', className: 'text-small' },
  { label: 'Caption', className: 'text-caption' },
  { label: 'Label', className: 'text-label' },
];

const RADIUS_TOKENS = ['xs', 'sm', 'control', 'surface', 'lg', 'full'];
const SHADOW_TOKENS = ['xs', 'sm', 'md', 'lg', 'overlay'];
const DURATION_TOKENS = ['instant', 'fast', 'base', 'slow'];

export function TokensSection({ locale }: { locale: Locale }) {
  const sample = locale === 'ar' ? 'سيارة فاخرة موديل 2026' : 'Premium car — model 2026';

  return (
    <section className="flex flex-col gap-10">
      <SectionHeading
        id="tokens"
        title={locale === 'ar' ? 'رموز التصميم' : 'Design tokens'}
        description={
          locale === 'ar'
            ? 'كل قيمة تصميم في المنصة تُشتق من هذه الرموز — لا قيم خام في الكود.'
            : 'Every design value in the platform comes from these tokens — never a raw value in code.'
        }
      />

      <div className="flex flex-col gap-6">
        <SubHeading>{locale === 'ar' ? 'الألوان' : 'Colors'}</SubHeading>
        {COLOR_GROUPS.map((group) => (
          <div key={group.label.en} className="flex flex-col gap-2">
            <p className="text-caption text-(--color-text-muted)">{group.label[locale]}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {group.tokens.map((token) => (
                <ColorSwatch key={token} token={token} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <SubHeading>{locale === 'ar' ? 'المقياس النصي' : 'Type scale'}</SubHeading>
        <div className="flex flex-col divide-y divide-(--color-border) rounded-(--radius-surface) border border-(--color-border)">
          {TYPE_SCALE.map((item) => (
            <div key={item.label} className="flex items-baseline gap-4 px-4 py-3">
              <code className="w-20 shrink-0 text-caption text-(--color-text-muted)">
                {item.label}
              </code>
              <p className={`${item.className} text-(--color-text)`}>{sample}</p>
            </div>
          ))}
          <div className="flex items-baseline gap-4 px-4 py-3">
            <code className="w-20 shrink-0 text-caption text-(--color-text-muted)">Price</code>
            <p className="tabular-nums text-price text-(--color-text)">
              ١٬٢٥٠٫٠٠ ر.س / 1,250.00 SAR
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
        <div className="flex flex-col gap-3">
          <SubHeading>{locale === 'ar' ? 'الانحناء' : 'Radius'}</SubHeading>
          <div className="flex flex-wrap gap-3">
            {RADIUS_TOKENS.map((token) => (
              <div key={token} className="flex flex-col items-center gap-1.5">
                <div
                  className="size-14 border border-(--color-border) bg-(--color-secondary)"
                  style={{ borderRadius: `var(--radius-${token})` }}
                />
                <code className="text-caption text-(--color-text-muted)">{token}</code>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <SubHeading>{locale === 'ar' ? 'الظل' : 'Shadow'}</SubHeading>
          <div className="flex flex-wrap gap-4">
            {SHADOW_TOKENS.map((token) => (
              <div key={token} className="flex flex-col items-center gap-1.5">
                <div
                  className="size-14 rounded-(--radius-control) bg-(--color-surface)"
                  style={{ boxShadow: `var(--shadow-${token})` }}
                />
                <code className="text-caption text-(--color-text-muted)">{token}</code>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <SubHeading>{locale === 'ar' ? 'الحركة (مرّر المؤشر)' : 'Motion (hover)'}</SubHeading>
          <div className="flex flex-wrap gap-4">
            {DURATION_TOKENS.map((token) => (
              <div key={token} className="group flex flex-col items-center gap-1.5">
                <div
                  className="size-14 rounded-(--radius-control) bg-(--color-primary) transition-transform ease-(--ease-standard) group-hover:scale-90"
                  style={{ transitionDuration: `var(--duration-${token})` }}
                />
                <code className="text-caption text-(--color-text-muted)">{token}</code>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
