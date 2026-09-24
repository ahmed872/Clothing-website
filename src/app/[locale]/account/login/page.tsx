import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { isLocale, type Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getOptionalCustomerAccount } from '@/lib/customers/customer-identity';
import { safeAccountRedirect } from '@/lib/customers/safe-redirect';
import { LoginForm } from '@/components/storefront/account/login-form';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

/**
 * The storefront's own sign-in — a completely different page, form, action
 * and Auth.js instance from `/admin/login` (P12 §3). An already-signed-in
 * customer is bounced straight to `/account`, the same "don't show the form
 * again" courtesy the admin login page already gives.
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
    title: getDictionary(locale).account.loginTitle,
    robots: { index: false, follow: false },
  };
}

export default async function CustomerLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  const t = getDictionary(locale).account;

  const account = await getOptionalCustomerAccount();
  const query = await searchParams;
  const rawNext = Array.isArray(query.next) ? query.next[0] : query.next;

  if (account) {
    redirect(safeAccountRedirect(locale, rawNext));
  }

  return (
    <div className="container mx-auto flex min-h-[70vh] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <CardTitle>{t.loginTitle}</CardTitle>
          <CardDescription>{t.loginSubtitle}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <LoginForm
            locale={locale}
            labels={{
              emailLabel: t.emailLabel,
              passwordLabel: t.passwordLabel,
              showPassword: t.showPassword,
              hidePassword: t.hidePassword,
              submit: t.signIn,
              submitting: t.signingIn,
              errors: {
                validation: t.errorValidation,
                invalid_credentials: t.errorInvalidCredentials,
                rate_limited: t.errorRateLimited,
              },
            }}
          />
          <div className="flex flex-col items-center gap-2 text-small">
            <Link
              href={`/${locale}/account/forgot-password`}
              className="text-(--color-text-muted) underline-offset-4 hover:text-(--color-text) hover:underline"
            >
              {t.forgotPasswordLink}
            </Link>
            <p className="text-(--color-text-muted)">
              {t.noAccountYet}{' '}
              <Link
                href={`/${locale}/account/register${rawNext ? `?next=${encodeURIComponent(rawNext)}` : ''}`}
                className="font-medium text-(--color-text) underline-offset-4 hover:underline"
              >
                {t.registerLink}
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
