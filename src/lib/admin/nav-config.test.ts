import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ADMIN_SECTIONS, buildAdminNavSections, getAdminSection } from './nav-config';

describe('ADMIN_SECTIONS', () => {
  it('covers every P07+ area with a real, declared permission', () => {
    for (const section of ADMIN_SECTIONS) {
      expect(section.slug).toBeTruthy();
      expect(section.permission).toBeTruthy();
    }
  });

  it('getAdminSection finds a known slug and rejects an unknown one', () => {
    expect(getAdminSection('products')?.permission).toBe('products.read');
    expect(getAdminSection('nonexistent-section')).toBeUndefined();
  });

  /**
   * The invariant the deleted `/admin/[section]` placeholder used to cover.
   *
   * Until P15 an unbuilt section fell through to a shared "being built"
   * page. Every section now has a real screen, so that catch-all is gone —
   * which means a slug added here without a route would 404 for whoever
   * clicked the sidebar link. This fails first instead.
   */
  it('every section in the sidebar has a route of its own', () => {
    const shell = join(process.cwd(), 'src/app/admin/(shell)');
    const routes = new Set(
      readdirSync(shell, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    );

    const missing = ADMIN_SECTIONS.filter((section) => !routes.has(section.slug));
    expect(missing.map((section) => section.slug)).toEqual([]);
  });

  it('no longer relies on a catch-all placeholder route', () => {
    const shell = join(process.cwd(), 'src/app/admin/(shell)');
    expect(readdirSync(shell)).not.toContain('[section]');
  });
});

describe('buildAdminNavSections', () => {
  it('OWNER sees every group, including Administration (users.manage)', () => {
    const sections = buildAdminNavSections('OWNER', 'en');
    const groupKeys = sections.map((s) => s.key);
    expect(groupKeys).toEqual(['overview', 'catalog', 'sales', 'store', 'administration']);
  });

  it('MANAGER sees every group except Administration', () => {
    const sections = buildAdminNavSections('MANAGER', 'en');
    const groupKeys = sections.map((s) => s.key);
    expect(groupKeys).not.toContain('administration');
    expect(groupKeys).toContain('catalog');
    expect(groupKeys).toContain('store');
  });

  it('STAFF sees only Dashboard, Catalog (read-only items), and Sales — never Store or Administration', () => {
    const sections = buildAdminNavSections('STAFF', 'en');
    const groupKeys = sections.map((s) => s.key);
    expect(groupKeys).not.toContain('store');
    expect(groupKeys).not.toContain('administration');

    const catalog = sections.find((s) => s.key === 'catalog');
    expect(catalog?.items.map((i) => i.key)).toEqual(['products', 'inventory']);
  });

  it('CUSTOMER sees only the Dashboard entry — no admin group has any permission it holds', () => {
    const sections = buildAdminNavSections('CUSTOMER', 'en');
    expect(sections).toEqual([
      { key: 'overview', items: [{ key: 'dashboard', label: 'Dashboard', href: '/admin' }] },
    ]);
  });

  it('renders each item label in the requested language', () => {
    const ar = buildAdminNavSections('OWNER', 'ar');
    const en = buildAdminNavSections('OWNER', 'en');
    const arDashboard = ar[0]!.items[0]!;
    const enDashboard = en[0]!.items[0]!;
    expect(arDashboard.label).toBe('لوحة التحكم');
    expect(enDashboard.label).toBe('Dashboard');
  });

  it('never includes a group with zero visible items', () => {
    for (const role of ['OWNER', 'MANAGER', 'STAFF', 'CUSTOMER'] as const) {
      const sections = buildAdminNavSections(role, 'en');
      for (const section of sections) {
        expect(section.items.length).toBeGreaterThan(0);
      }
    }
  });
});
