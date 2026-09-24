import type { Metadata } from 'next';

import { isLocale, type Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { requireCustomerAccount } from '@/lib/customers/customer-identity';
import { resolveCustomerForUser } from '@/modules/customers';
import { ProfileForm } from '@/components/storefront/account/profile-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  return {
    title: getDictionary(locale).account.navProfile,
    robots: { index: false, follow: false },
  };
}

export default async function AccountProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  const t = getDictionary(locale).account;

  const account = await requireCustomerAccount();
  const customer = await resolveCustomerForUser(account.userId);

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle as="h2">{t.profileFormTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        <ProfileForm
          locale={locale}
          email={account.email}
          initialName={account.name ?? ''}
          initialPhone={customer.phone ?? ''}
          labels={{
            nameLabel: t.nameLabel,
            emailLabel: t.emailLabel,
            phoneLabel: t.phoneLabel,
            optional: t.optional,
            emailReadOnlyNote: t.emailReadOnlyNote,
            saveChanges: t.saveChanges,
            saving: t.saving,
            updatedToast: t.profileUpdated,
          }}
        />
      </CardContent>
    </Card>
  );
}
