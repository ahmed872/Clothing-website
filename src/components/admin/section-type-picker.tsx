import Link from 'next/link';
import type { HomepageSectionType } from '@generated/prisma';

/**
 * Step one of creating a section: which of the ten.
 *
 * Plain links rather than a `<select>` — each type needs a sentence
 * explaining what it puts on the page, and a store owner choosing between
 * "Featured products" and "Best sellers" is choosing on that sentence, not
 * on the name.
 */
export function SectionTypePicker({
  types,
  labels,
}: {
  types: HomepageSectionType[];
  labels: { types: Record<string, string>; typeHelp: Record<string, string> };
}) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {types.map((type) => (
        <li key={type}>
          <Link
            href={`/admin/content/new?type=${type}`}
            className="flex h-full flex-col gap-1 rounded-(--radius-container) border border-(--color-border) bg-(--color-surface) p-4 transition-colors duration-(--duration-fast) hover:border-(--color-border-strong) focus-visible:ring-2 focus-visible:ring-(--color-ring)/25 focus-visible:outline-none"
          >
            <span className="text-body font-medium text-(--color-text)">{labels.types[type]}</span>
            <span className="text-small text-(--color-text-muted)">{labels.typeHelp[type]}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
