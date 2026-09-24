import type { Metadata } from 'next';
import Link from 'next/link';

import { isLocale, type Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { ResetPasswordForm } from '@/components/storefront/account/reset-password-form';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * The token lives only in the URL a real emailed link would carry — read
 * here, server-side, and bound into the form action; never re-rendered back
 * into a hidden input a client script could read.
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
    title: getDictionary(locale).account.resetPasswordTitle,
    robots: { index: false, follow: false },
  };
}

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  const t = getDictionary(locale).account;

  const query = await searchParams;
  const rawToken = Array.isArray(query.token) ? query.token[0] : query.token;

  return (
    <div className="container mx-auto flex min-h-[70vh] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <CardTitle>{t.resetPasswordTitle}</CardTitle>
          {rawToken ? <CardDescription>{t.resetPasswordSubtitle}</CardDescription> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {rawToken ? (
            <ResetPasswordForm
              locale={locale}
              token={rawToken}
              labels={{
                passwordLabel: t.passwordLabel,
                passwordConfirmationLabel: t.passwordConfirmationLabel,
                passwordHint: t.passwordHint,
                showPassword: t.showPassword,
                hidePassword: t.hidePassword,
                submit: t.resetPasswordSubmit,
                submitting: t.resetPasswordSubmitting,
                errors: {
                  validation: t.errorValidation,
                  passwords_do_not_match: t.errorPasswordMismatch,
                  invalid: t.resetPasswordErrorInvalid,
                  expired: t.resetPasswordErrorExpired,
                  used: t.resetPasswordErrorUsed,
                },
                successTitle: t.resetPasswordSuccessTitle,
                successBody: t.resetPasswordSuccessBody,
                goToLogin: t.goToLogin,
              }}
            />
          ) : (
            <>
              <Alert variant="error">{t.resetPasswordErrorInvalid}</Alert>
              <Button asChild size="lg">
                <Link href={`/${locale}/account/forgot-password`}>{t.forgotPasswordTitle}</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
