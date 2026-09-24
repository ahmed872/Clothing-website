import { redirect } from 'next/navigation';

import { isLocale, type Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getOptionalCustomerAccount } from '@/lib/customers/customer-identity';
import { AccountNav } from '@/components/storefront/account/account-nav';
import { SignOutButton } from '@/components/storefront/account/sign-out-button';

/**
 * The real server-side gate for every account page a customer must be
 * signed in to see (P12 §16/§20) — `getOptionalCustomerAccount()` re-checks
 * the live session and the `Customer` row on every request, the same
 * discipline `admin/(shell)/layout.tsx` applies for admin routes. Like that
 * layout, the redirect here does not carry a `next` back-link: reaching this
 * gate signed out means following an account link found while signed out
 * (the nav, a bookmark), not an interrupted task with somewhere specific to
 * return to — that case is `placeOrderAction`'s and checkout's own "sign in
 * to continue" links, which already build a validated `next` themselves.
 *
 * `/account/login`, `/account/register`, `/account/forgot-password`,
 * `/account/reset-password` and `/account/verify-email` all sit outside
 * this group specifically so they never run this check. `/account/orders/
 * [number]` also stays outside it (a different directory, same URL prefix)
 * because a guest with an order access token must still be able to open it
 * — this gate would otherwise turn that P10 guest path into a 404.
 */
export default async function AccountProtectedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';

  const account = await getOptionalCustomerAccount();
  if (!account) {
    redirect(`/${locale}/account/login`);
  }

  const t = getDictionary(locale).account;

  return (
    <div className="container mx-auto flex flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-h3 text-(--color-text)">{t.accountTitle}</h1>
        <SignOutButton locale={locale} label={t.navSignOut} signingOutLabel={t.signingOut} />
      </div>
      <AccountNav
        locale={locale}
        labels={{ navOverview: t.navOverview, navProfile: t.navProfile, navOrders: t.navOrders }}
      />
      {children}
    </div>
  );
}
