import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { auth } from '@/modules/identity';
import { getStoreSettings } from '@/modules/settings';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { buildAdminNavSections } from '@/lib/admin/nav-config';
import { AdminSidebarNav, AdminNavDrawer } from '@/components/admin/admin-sidebar-nav';
import { AdminLocaleToggle } from '@/components/admin/admin-locale-toggle';
import { ThemeToggle } from '@/components/storefront/theme-toggle';
import { UserMenu } from '@/components/admin/user-menu';

/**
 * The real server-side auth gate (P06 §16): `auth()` re-validates the DB
 * session and live user on every request (see `auth.ts`'s `jwt` callback) —
 * this is not "check a client boolean and redirect," it is a Server
 * Component reading the one source of truth before it renders a single byte
 * of protected UI. Every route under this group (`/admin`, `/admin/[section]`)
 * inherits this check simply by existing here; `/admin/login` sits outside
 * this route group specifically so it never runs it.
 */
export default async function AdminShellLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role) {
    redirect('/admin/login');
  }

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  const { name, email, role } = session.user;
  const navSections = buildAdminNavSections(role, locale);
  const roleLabel = t.roles[role];

  /**
   * The store's own name, not a hardcoded wordmark.
   *
   * This was literally the string "LuxeDrive" until P15 — so an owner could
   * rename their store in Settings, watch the storefront pick it up, and
   * still be looking at someone else's brand in their own admin panel. The
   * whole point of `StoreSettings` is that the store's identity is data.
   *
   * Read uncached, unlike the storefront's header: an admin who has just
   * pressed Save on the settings form is the one person who must never be
   * shown a stale name.
   */
  const settings = await getStoreSettings(locale);
  const storeName = locale === 'ar' ? settings.storeNameAr : settings.storeNameEn;

  return (
    <div className="flex min-h-screen">
      <a
        href="#admin-main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:rounded-(--radius-control) focus:bg-(--color-primary) focus:px-4 focus:py-2 focus:text-(--color-primary-foreground)"
      >
        {t.shell.skipToContent}
      </a>

      <AdminSidebarNav
        sections={navSections}
        navLabel={t.shell.mainNav}
        header={<span className="text-h6 font-bold text-(--color-text)">{storeName}</span>}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-end gap-2 border-b border-(--color-border) bg-(--color-surface) px-4 sm:px-6">
          <AdminNavDrawer
            sections={navSections}
            navLabel={t.shell.mainNav}
            openMenuLabel={t.shell.openMenu}
            header={<span className="text-h6 font-bold text-(--color-text)">{storeName}</span>}
          />
          <AdminLocaleToggle locale={locale} label={t.shell.language} />
          <ThemeToggle label={t.shell.toggleTheme} />
          <UserMenu
            name={name ?? null}
            email={email ?? ''}
            roleLabel={roleLabel}
            labels={{
              userMenu: t.shell.userMenu,
              signOut: t.shell.signOut,
              signingOut: t.shell.signingOut,
            }}
          />
        </header>

        <main id="admin-main-content" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
