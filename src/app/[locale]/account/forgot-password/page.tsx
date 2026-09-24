import type { Metadata } from 'next';
import Link from 'next/link';

import { isLocale, type Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { ForgotPasswordForm } from '@/components/storefront/account/forgot-password-form';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  return {
    title: getDictionary(locale).account.forgotPasswordTitle,
    robots: { index: false, follow: false },
  };
}

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  const t = getDictionary(locale).account;

  return (
    <div className="container mx-auto flex min-h-[70vh] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <CardTitle>{t.forgotPasswordTitle}</CardTitle>
          <CardDescription>{t.forgotPasswordSubtitle}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <ForgotPasswordForm
            labels={{
              emailLabel: t.emailLabel,
              submit: t.forgotPasswordSubmit,
              submitting: t.forgotPasswordSubmitting,
              errorValidation: t.errorValidation,
              successTitle: t.forgotPasswordSuccessTitle,
              successBody: t.forgotPasswordSuccessBody,
            }}
          />
          <Link
            href={`/${locale}/account/login`}
            className="text-center text-small text-(--color-text-muted) underline-offset-4 hover:text-(--color-text) hover:underline"
          >
            {t.backToLogin}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
