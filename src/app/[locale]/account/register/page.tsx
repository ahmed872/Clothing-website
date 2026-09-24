import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { isLocale, type Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getOptionalCustomerAccount } from '@/lib/customers/customer-identity';
import { safeAccountRedirect } from '@/lib/customers/safe-redirect';
import { RegisterForm } from '@/components/storefront/account/register-form';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

/**
 * Registration. No role field anywhere on this page or the form it renders
 * (P12 §3/§4) — `registerAction` hard-codes `CUSTOMER` server-side.
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
    title: getDictionary(locale).account.registerTitle,
    robots: { index: false, follow: false },
  };
}

export default async function CustomerRegisterPage({
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
          <CardTitle>{t.registerTitle}</CardTitle>
          <CardDescription>{t.registerSubtitle}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <RegisterForm
            locale={locale}
            labels={{
              nameLabel: t.nameLabel,
              emailLabel: t.emailLabel,
              phoneLabel: t.phoneLabel,
              optional: t.optional,
              passwordLabel: t.passwordLabel,
              passwordConfirmationLabel: t.passwordConfirmationLabel,
              passwordHint: t.passwordHint,
              showPassword: t.showPassword,
              hidePassword: t.hidePassword,
              submit: t.createAccount,
              submitting: t.creatingAccount,
              errors: {
                validation: t.errorValidation,
                email_taken: t.errorEmailTaken,
                passwords_do_not_match: t.errorPasswordMismatch,
                generic: t.errorGeneric,
              },
            }}
          />
          <p className="text-center text-small text-(--color-text-muted)">
            {t.alreadyHaveAccount}{' '}
            <Link
              href={`/${locale}/account/login${rawNext ? `?next=${encodeURIComponent(rawNext)}` : ''}`}
              className="font-medium text-(--color-text) underline-offset-4 hover:underline"
            >
              {t.signInLink}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
