import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { PERMISSIONS, roleHasPermission } from '@/modules/identity';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminUser } from '@/lib/admin/require-admin';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { Badge } from '@/components/ui/badge';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * The one page P06 builds inside the admin shell — everything on it is real
 * (the caller's own session, their real granted permissions), nothing is a
 * placeholder KPI or invented number. `requireAdminUser()` here is a
 * second, independent check on top of the shell layout's — the same "every
 * boundary checks for itself" posture the security test matrix (P06 §7/§17)
 * verifies by calling boundaries directly, not just relying on the layout
 * above it. It redirects rather than throwing raw on `UNAUTHENTICATED`
 * specifically because Next renders a layout and its page concurrently, not
 * strictly one after the other — see `require-admin.ts`.
 */
export default async function AdminDashboardPage() {
  const user = await requireAdminUser();

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  const grantedPermissions = PERMISSIONS.filter((permission) =>
    roleHasPermission(user.role, permission),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.dashboard.welcomeTitle}
        description={t.dashboard.welcomeBody}
        breadcrumb={<AdminBreadcrumbs dashboardLabel={t.shell.dashboard} trail={[]} />}
      />

      <section className="flex flex-col gap-3 rounded-(--radius-container) border border-(--color-border) bg-(--color-surface) p-5">
        <h2 className="text-h6 font-semibold text-(--color-text)">{t.dashboard.accountTitle}</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-caption text-(--color-text-muted)">{t.dashboard.email}</dt>
            <dd className="text-sm text-(--color-text) tabular-nums">{user.email}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-caption text-(--color-text-muted)">{t.dashboard.role}</dt>
            <dd>
              <Badge variant="brand">{t.roles[user.role]}</Badge>
            </dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-3 rounded-(--radius-container) border border-(--color-border) bg-(--color-surface) p-5">
        <h2 className="text-h6 font-semibold text-(--color-text)">
          {t.dashboard.permissionsTitle}
        </h2>
        {grantedPermissions.length === 0 ? (
          <p className="text-small text-(--color-text-muted)">{t.dashboard.noPermissions}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {grantedPermissions.map((permission) => (
              <li key={permission}>
                <Badge variant="neutral">{t.permissions[permission]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
