import type { Metadata } from 'next';
import Link from 'next/link';

import { isLocale, type Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { verifyEmailToken } from '@/modules/customers';
import { recordAuditEvent } from '@/modules/identity';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * "Click a link" is the whole interaction — the token is consumed
 * server-side the moment this page renders, with no client form in between
 * (P12 §12). Every outcome (missing token, invalid, expired, used, success)
 * collapses to one of four static messages; none of them is reachable twice
 * for the same token, since `verifyEmailToken` marks it used in the same
 * transaction that verifies the account.
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
    title: getDictionary(locale).account.verifyEmailTitle,
    robots: { index: false, follow: false },
  };
}

export default async function VerifyEmailPage({
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

  let body: { variant: 'success' | 'error'; title: string; message: string };

  if (!rawToken) {
    body = { variant: 'error', title: t.verifyEmailTitle, message: t.verifyEmailErrorInvalid };
  } else {
    const result = await verifyEmailToken(rawToken);
    if (result.ok) {
      await recordAuditEvent({ action: 'customer.email_verified', userId: result.userId });
      body = {
        variant: 'success',
        title: t.verifyEmailSuccessTitle,
        message: t.verifyEmailSuccessBody,
      };
    } else {
      const message =
        result.reason === 'expired'
          ? t.verifyEmailErrorExpired
          : result.reason === 'used'
            ? t.verifyEmailErrorUsed
            : t.verifyEmailErrorInvalid;
      body = { variant: 'error', title: t.verifyEmailTitle, message };
    }
  }

  return (
    <div className="container mx-auto flex min-h-[70vh] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <CardTitle>{body.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Alert variant={body.variant === 'success' ? 'success' : 'error'}>{body.message}</Alert>
          <Button asChild size="lg">
            <Link href={`/${locale}/account`}>{t.navOverview}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
