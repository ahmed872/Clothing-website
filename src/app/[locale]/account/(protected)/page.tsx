import type { Metadata } from 'next';
import Link from 'next/link';
import { Package, User } from 'lucide-react';

import { isLocale, type Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { requireCustomerAccount } from '@/lib/customers/customer-identity';
import { isEmailVerified } from '@/modules/customers';
import { ResendVerificationButton } from '@/components/storefront/account/resend-verification-button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * The overview: a greeting, an unverified-email notice when it applies, and
 * two links onward. Nothing more — P12 §20 rules out a generic SaaS
 * dashboard's widgets for an account with exactly two things in it so far.
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
    title: getDictionary(locale).account.accountTitle,
    robots: { index: false, follow: false },
  };
}

export default async function AccountOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  const t = getDictionary(locale).account;

  // The layout above already gates this route; calling the throwing form
  // here too costs nothing and keeps this page correct if it is ever
  // reached another way.
  const account = await requireCustomerAccount();
  const verified = await isEmailVerified(account.userId);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-(--color-text-muted)">
        {t.welcomeBack.replace('{name}', account.name ?? account.email)}
      </p>

      {!verified ? (
        <Alert variant="warning" title={t.verifyEmailPendingNotice}>
          <div className="mt-2">
            <ResendVerificationButton
              label={t.resendVerification}
              sendingLabel={t.resendingVerification}
              successMessage={t.resendVerificationSuccess}
            />
          </div>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <span className="flex size-10 items-center justify-center rounded-(--radius-full) bg-(--color-muted)">
              <Package className="size-5 text-(--color-text-muted)" aria-hidden="true" />
            </span>
            <CardTitle as="h2">{t.overviewOrdersTitle}</CardTitle>
            <CardDescription>{t.overviewOrdersBody}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="sm" variant="outline">
              <Link href={`/${locale}/account/orders`}>{t.overviewOrdersCta}</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <span className="flex size-10 items-center justify-center rounded-(--radius-full) bg-(--color-muted)">
              <User className="size-5 text-(--color-text-muted)" aria-hidden="true" />
            </span>
            <CardTitle as="h2">{t.overviewProfileTitle}</CardTitle>
            <CardDescription>{t.overviewProfileBody}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="sm" variant="outline">
              <Link href={`/${locale}/account/profile`}>{t.overviewProfileCta}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
