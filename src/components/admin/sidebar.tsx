import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface SidebarNavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  active?: boolean;
}

export interface SidebarSection {
  key: string;
  label?: string;
  items: SidebarNavItem[];
}

export interface SidebarProps {
  sections: SidebarSection[];
  header?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  /** Distinguishes this `<nav>` from any other landmark on the page (breadcrumb, in-page TOC, …) for assistive tech. */
  navLabel?: string;
}

/**
 * The admin's primary navigation. A plain `<nav>`, not a collapsible tree —
 * store admin has one level of grouping, and a second level is a product
 * decision for a later phase, not a component-library concern now.
 */
export function Sidebar({ sections, header, footer, className, navLabel = 'Main' }: SidebarProps) {
  return (
    <aside
      className={cn(
        'flex h-full w-64 shrink-0 flex-col gap-6 border-e border-(--color-border) bg-(--color-surface) p-4',
        className,
      )}
    >
      {header ? <div className="px-2">{header}</div> : null}

      <nav aria-label={navLabel} className="flex flex-1 flex-col gap-6 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.key} className="flex flex-col gap-1">
            {section.label ? (
              <p className="px-2 text-caption font-medium tracking-wide text-(--color-text-muted) uppercase">
                {section.label}
              </p>
            ) : null}
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => (
                <li key={item.key}>
                  <a
                    href={item.href}
                    aria-current={item.active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-(--radius-control) px-2.5 py-2 text-sm font-medium outline-none',
                      'transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-(--color-ring)/25',
                      item.active
                        ? 'bg-(--color-secondary) text-(--color-text)'
                        : 'text-(--color-text-muted) hover:bg-(--color-surface-raised) hover:text-(--color-text)',
                    )}
                  >
                    <item.icon className="size-4.5 shrink-0" aria-hidden="true" />
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {footer ? <div className="border-t border-(--color-border) px-2 pt-4">{footer}</div> : null}
    </aside>
  );
}
