import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { auth } from '@/modules/identity';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LoginForm } from '@/components/admin/login-form';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };

/**
 * Deliberately outside the `(shell)` route group — this is the one `/admin`
 * page that must render for a signed-out visitor, so it sits above the
 * shell layout's auth gate rather than under it. Already-signed-in visitors
 * are bounced to `/admin` rather than shown the form again.
 *
 * No demo credentials, no hint of implementation (no "using Auth.js",
 * no test-account text) anywhere on this page — P06 §10.
 */
export default async function AdminLoginPage() {
  const session = await auth();
  if (session?.user?.id) {
    redirect('/admin');
  }

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <CardTitle>{t.login.title}</CardTitle>
          <CardDescription>{t.login.subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm
            labels={{
              emailLabel: t.login.emailLabel,
              emailPlaceholder: t.login.emailPlaceholder,
              passwordLabel: t.login.passwordLabel,
              passwordPlaceholder: t.login.passwordPlaceholder,
              showPassword: t.login.showPassword,
              hidePassword: t.login.hidePassword,
              submit: t.login.submit,
              submitting: t.login.submitting,
              errors: {
                validation: t.login.errorValidation,
                invalid_credentials: t.login.errorInvalidCredentials,
                rate_limited: t.login.errorRateLimited,
              },
            }}
          />
        </CardContent>
      </Card>
    </main>
  );
}
