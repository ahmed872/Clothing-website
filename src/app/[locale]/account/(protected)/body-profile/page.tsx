import type { Metadata } from 'next';

import { isLocale, type Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { requireCustomerAccount } from '@/lib/customers/customer-identity';
import { getBodyProfile, serializeBodyProfile } from '@/modules/body-profile';
import { BodyProfileForm } from '@/components/storefront/body-profile/body-profile-form';

/**
 * The customer's fit profile (clothing P01). Behind the `(protected)`
 * layout's sign-in gate like every account page, and it asks the session
 * again itself: the profile read is keyed by *this* session's customer, the
 * only way this page can reach a profile at all — there is no id in the URL.
 *
 * Dynamic, never cached: measurements are private, so no rendered copy of
 * this page may be served to anyone else.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  return {
    title: getDictionary(locale).bodyProfile.title,
    robots: { index: false, follow: false },
  };
}

export default async function AccountBodyProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  const t = getDictionary(locale).bodyProfile;

  const account = await requireCustomerAccount();
  // One query: the profile with its avatar configuration.
  const profile = await getBodyProfile(account.customerId);

  return (
    <section aria-labelledby="body-profile-title" className="flex flex-col gap-6">
      <header className="flex max-w-2xl flex-col gap-2">
        <h2 id="body-profile-title" className="text-h4 text-(--color-text)">
          {t.title}
        </h2>
        <p className="text-body text-(--color-text-muted)">{t.intro}</p>
        <p className="text-small text-(--color-text-subtle)">{t.privacyNote}</p>
      </header>
      <BodyProfileForm
        locale={locale}
        labels={t}
        initialProfile={profile ? serializeBodyProfile(profile) : null}
      />
    </section>
  );
}
