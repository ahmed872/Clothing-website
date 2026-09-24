'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  Menu,
  LayoutDashboard,
  Package,
  Tag,
  Boxes,
  ClipboardList,
  Users2,
  Percent,
  FileText,
  BarChart3,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

import { Sidebar, type SidebarSection } from '@/components/admin/sidebar';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import type { AdminNavSectionConfig } from '@/lib/admin/nav-config';

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  products: Package,
  categories: Tag,
  brands: Tag,
  inventory: Boxes,
  orders: ClipboardList,
  customers: Users2,
  discounts: Percent,
  content: FileText,
  analytics: BarChart3,
  settings: Settings,
  users: ShieldCheck,
};

export interface AdminSidebarNavProps {
  sections: AdminNavSectionConfig[];
  navLabel: string;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}

/** Turns the plain, server-decided nav config into `Sidebar`'s shape, marking
 * the item matching the current pathname as current. Shared by the desktop
 * sidebar and the small-screen drawer so there is exactly one nav
 * definition with two presentations. */
function useSidebarSections(sections: AdminNavSectionConfig[]): SidebarSection[] {
  const pathname = usePathname();

  return sections.map((section) => ({
    key: section.key,
    label: section.label,
    items: section.items.map((item) => ({
      key: item.key,
      label: item.label,
      href: item.href,
      icon: ICONS[item.key] ?? LayoutDashboard,
      active: item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href),
    })),
  }));
}

/**
 * The only client piece of the admin shell's navigation: which link is
 * "current" depends on the pathname, and there is no server API for that
 * inside a layout — everything else (which sections/items exist at all,
 * per the caller's role) is decided server-side in `nav-config.ts` and
 * passed down as plain data.
 *
 * Below `lg` this renders nothing: a fixed 16rem rail would eat most of a
 * phone's width, so the same nav is reached from the header's
 * `AdminNavDrawer` trigger instead.
 */
export function AdminSidebarNav({ sections, navLabel, header, footer }: AdminSidebarNavProps) {
  const sidebarSections = useSidebarSections(sections);

  return (
    <Sidebar
      sections={sidebarSections}
      navLabel={navLabel}
      header={header}
      footer={footer}
      className="hidden lg:flex"
    />
  );
}

export interface AdminNavDrawerProps extends AdminSidebarNavProps {
  /** Accessible name for the trigger that opens the nav drawer. */
  openMenuLabel: string;
}

/** The small-screen half of the same navigation — a header trigger opening
 * the identical `Sidebar` in a drawer. Hidden from `lg` up, where the real
 * sidebar is always on screen. */
export function AdminNavDrawer({
  sections,
  navLabel,
  openMenuLabel,
  header,
  footer,
}: AdminNavDrawerProps) {
  const pathname = usePathname();
  const sidebarSections = useSidebarSections(sections);
  const [open, setOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);

  // Navigating closes the drawer, so it never sits over the page the admin
  // just asked for. Adjusted during render (React's documented
  // "state derived from a changing prop" pattern) rather than in an effect:
  // no extra commit, and no rendering the drawer open over the new page for
  // a frame first.
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  return (
    <div className="me-auto lg:hidden">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={openMenuLabel}
        onClick={() => setOpen(true)}
      >
        <Menu className="size-5" aria-hidden="true" />
      </Button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent side="start" className="w-72 max-w-[85vw] p-0" closeLabel={navLabel}>
          <DrawerTitle className="sr-only">{navLabel}</DrawerTitle>
          <Sidebar
            sections={sidebarSections}
            navLabel={navLabel}
            header={header}
            footer={footer}
            className="w-full border-e-0"
          />
        </DrawerContent>
      </Drawer>
    </div>
  );
}
