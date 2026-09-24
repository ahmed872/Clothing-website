import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { UserForm } from '@/components/admin/user-form';

export const metadata: Metadata = { title: 'New user' };

export default async function NewAdminUserPage() {
  await requireAdminPermission('users.manage');

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.users.newUser}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[{ label: t.users.title, href: '/admin/users' }, { label: t.users.newUser }]}
          />
        }
      />

      <UserForm
        locale={locale}
        labels={{
          emailLabel: t.users.emailLabel,
          nameLabel: t.users.nameLabel,
          nameOptional: t.users.nameOptional,
          passwordLabel: t.users.passwordLabel,
          passwordHelp: t.users.passwordHelp,
          showPassword: t.users.showPassword,
          hidePassword: t.users.hidePassword,
          roleLabel: t.users.roleLabel,
          roles: { OWNER: t.roles.OWNER, MANAGER: t.roles.MANAGER, STAFF: t.roles.STAFF },
          roleHelp: {
            OWNER: t.users.roleHelpOWNER,
            MANAGER: t.users.roleHelpMANAGER,
            STAFF: t.users.roleHelpSTAFF,
          },
          submit: t.users.createUser,
          submitting: t.common.saving,
          cancel: t.common.cancel,
          requiredField: t.common.requiredField,
          created: t.users.created,
          invalidEmail: t.login.errorValidation,
        }}
      />
    </div>
  );
}
