import type { Role } from '@generated/prisma';
import type { Permission } from '@/modules/identity';
import { roleHasPermission } from '@/modules/identity';

import type { Locale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';

/**
 * Every admin area, each named by the one `Permission` that gates it —
 * this is the "permission-aware navigation" P06 asks for, built against the
 * full permission set from day one so each later phase only had to build
 * the pages, never re-derive who may see them.
 *
 * As of P15 every entry below points at a real management screen, and the
 * shared "this section is being built" placeholder that used to catch the
 * unbuilt ones (`/admin/[section]`) is gone with them — a catch-all whose
 * only remaining job would be to say something false about a section that
 * exists. `nav-config.test.ts` now holds the invariant it used to cover:
 * adding a slug here without building its route fails the test suite,
 * which is a louder and earlier signal than a placeholder page nobody
 * would have visited.
 *
 * Every one of these URLs calls `requirePermission` in its own page: a role
 * that can't see a link server-side can't reach it by typing the URL either
 * (P06 §7/§17).
 */
export interface AdminSection {
  slug: string;
  permission: Permission;
  group: 'catalog' | 'sales' | 'store' | 'administration';
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { slug: 'products', permission: 'products.read', group: 'catalog' },
  { slug: 'categories', permission: 'categories.manage', group: 'catalog' },
  { slug: 'brands', permission: 'brands.manage', group: 'catalog' },
  { slug: 'inventory', permission: 'inventory.read', group: 'catalog' },
  // P08. `products.update`, not `inventory.*`: changing what something costs
  // is a catalog write, which is why STAFF can count stock but not reprice.
  { slug: 'pricing', permission: 'products.update', group: 'catalog' },
  { slug: 'promotions', permission: 'discounts.manage', group: 'sales' },
  { slug: 'orders', permission: 'orders.read', group: 'sales' },
  { slug: 'customers', permission: 'customers.read', group: 'sales' },
  { slug: 'content', permission: 'content.manage', group: 'store' },
  { slug: 'analytics', permission: 'analytics.read', group: 'store' },
  { slug: 'settings', permission: 'settings.manage', group: 'store' },
  // P14. OWNER-only, and the only section in its group — see
  // `permissions.ts` for why granting other people access is not a
  // MANAGER's job.
  { slug: 'users', permission: 'users.manage', group: 'administration' },
];

export function getAdminSection(slug: string): AdminSection | undefined {
  return ADMIN_SECTIONS.find((section) => section.slug === slug);
}

export interface AdminNavItemConfig {
  key: string;
  label: string;
  href: string;
}

export interface AdminNavSectionConfig {
  key: string;
  label?: string;
  items: AdminNavItemConfig[];
}

/**
 * The sidebar's data, filtered to exactly what `role` may use — never
 * rendered-then-hidden. `Sidebar` (P02) only draws what it's given, so a
 * permission this role lacks never becomes a link at all, in either
 * language.
 */
export function buildAdminNavSections(role: Role, locale: Locale): AdminNavSectionConfig[] {
  const t = getAdminDictionary(locale);

  const dashboard: AdminNavSectionConfig = {
    key: 'overview',
    items: [{ key: 'dashboard', label: t.shell.dashboard, href: '/admin' }],
  };

  const groupOrder = ['catalog', 'sales', 'store', 'administration'] as const;
  const groups = groupOrder.map((group) => ({
    key: group,
    label: t.navGroups[group],
    items: ADMIN_SECTIONS.filter(
      (section) => section.group === group && roleHasPermission(role, section.permission),
    ).map((section) => ({
      key: section.slug,
      label: t.sections[section.slug as keyof typeof t.sections],
      href: `/admin/${section.slug}`,
    })),
  }));

  return [dashboard, ...groups.filter((group) => group.items.length > 0)];
}
