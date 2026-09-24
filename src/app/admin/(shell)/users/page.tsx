import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { Plus } from 'lucide-react';

import { listAdminUsers } from '@/modules/identity';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { formatAdminDate } from '@/lib/admin/format-admin-date';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { UsersTable, type UserRow } from '@/components/admin/users-table';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Users' };

/**
 * Staff administration (P14 §B).
 *
 * `users.manage` is OWNER-only (`permissions.ts`), and this call is what
 * enforces it — not the sidebar, which simply never renders the link for a
 * MANAGER or STAFF. Typing `/admin/users` as either of those throws
 * `FORBIDDEN` here, before a single row is read; `admin-users-security`
 * (unit) and `admin-route-protection` (e2e) both prove it against the real
 * boundary rather than against the hidden link.
 */
export default async function AdminUsersPage() {
  const actor = await requireAdminPermission('users.manage');

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  const users = await listAdminUsers();
  const rows: UserRow[] = users.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active,
    lastLoginLabel: user.lastLoginAt ? formatAdminDate(user.lastLoginAt, locale) : null,
    createdLabel: formatAdminDate(user.createdAt, locale),
    isSelf: user.id === actor.id,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.users.title}
        description={t.users.description}
        breadcrumb={
          <AdminBreadcrumbs dashboardLabel={t.shell.dashboard} trail={[{ label: t.users.title }]} />
        }
        actions={
          <Button asChild>
            <Link href="/admin/users/new">
              <Plus className="size-4" aria-hidden="true" />
              {t.users.newUser}
            </Link>
          </Button>
        }
      />

      <UsersTable
        rows={rows}
        locale={locale}
        labels={{
          colUser: t.users.colUser,
          colRole: t.users.colRole,
          colStatus: t.users.colStatus,
          colLastLogin: t.users.colLastLogin,
          colCreated: t.users.colCreated,
          actions: t.common.actions,
          emptyTitle: t.users.emptyTitle,
          emptyDescription: t.users.emptyDescription,
          neverSignedIn: t.users.neverSignedIn,
          statusActive: t.users.statusActive,
          statusDisabled: t.users.statusDisabled,
          you: t.users.you,
          roleLabel: t.users.roleLabel,
          roles: { OWNER: t.roles.OWNER, MANAGER: t.roles.MANAGER, STAFF: t.roles.STAFF },
          roleHelp: {
            OWNER: t.users.roleHelpOWNER,
            MANAGER: t.users.roleHelpMANAGER,
            STAFF: t.users.roleHelpSTAFF,
          },
          changeRole: t.users.changeRole,
          changeRoleTitle: t.users.changeRoleTitle,
          changeRoleDescription: t.users.changeRoleDescription,
          disable: t.users.disable,
          enable: t.users.enable,
          confirmDisableTitle: t.users.confirmDisableTitle,
          confirmDisableDescription: t.users.confirmDisableDescription,
          confirmEnableTitle: t.users.confirmEnableTitle,
          confirmEnableDescription: t.users.confirmEnableDescription,
          roleChanged: t.users.roleChanged,
          disabledToast: t.users.disabled,
          enabledToast: t.users.enabled,
          selfNotice: t.users.selfNotice,
          save: t.common.save,
          saving: t.common.saving,
          cancel: t.common.cancel,
          confirm: t.common.confirm,
        }}
      />
    </div>
  );
}
