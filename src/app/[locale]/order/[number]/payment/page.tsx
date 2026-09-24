import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { formatMoney } from '@/modules/core';
import { isPaymentEnabled, listAttemptsForOrder } from '@/modules/payments';
import { assessPayable } from '@/modules/orders';
import { isLocale, type Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { resolveOrderAccess } from '@/lib/orders/order-identity';
import { paymentAttemptLabel, paymentAttemptTone } from '@/lib/payments/payment-labels';
import { PaymentClient } from '@/components/storefront/payment/payment-client';
import { formatOrderDate } from '@/components/storefront/orders/order-detail';
import {
  OrderStatusBadge,
  PaymentStatusBadge,
} from '@/components/storefront/orders/order-status-badges';
import { StorefrontBreadcrumbs } from '@/components/storefront/listing/storefront-breadcrumbs';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Pay for an order — and the page the provider returns the customer to
 * (P11 §18/§19).
 *
 * The same page serves both because the answer is the same in both cases:
 * read the stored payment state and show it. Arriving here from a provider
 * redirect proves nothing and is treated as proving nothing — there is no
 * query parameter this page reads, no `?status=success` that means anything,
 * and no code path where being here changes a payment. What the customer
 * sees is whatever a verified webhook or an authenticated provider lookup
 * has already written.
 *
 * Access is `resolveOrderAccess` — P10's single authority — so "not yours"
 * and "does not exist" are the same 404.
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
    title: getDictionary(locale).payment.title,
    robots: { index: false, follow: false },
  };
}

export default async function OrderPaymentPage({
  params,
}: {
  params: Promise<{ locale: string; number: string }>;
}) {
  const { locale: raw, number } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  const t = getDictionary(locale).payment;
  const to = getDictionary(locale).orders;

  const access = await resolveOrderAccess(number);
  if (!access) notFound();

  const { order } = access;
  const attempts = await listAttemptsForOrder(order.id);
  const payable = assessPayable(order).payable && isPaymentEnabled();

  // "Awaiting confirmation" is a fact about our own records — an attempt is
  // open and unresolved — not an inference from how the customer got here.
  const awaitingConfirmation = attempts.some((attempt) =>
    ['CREATED', 'REQUIRES_ACTION', 'PENDING'].includes(attempt.status),
  );
  const paid = order.paymentStatus === 'PAID';
  const lastFailure = attempts.find((attempt) => attempt.status === 'FAILED');

  return (
    <div className="container mx-auto flex min-w-0 flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <StorefrontBreadcrumbs
        locale={locale}
        trail={[
          { label: to.myOrders, href: `/${locale}/account/orders` },
          { label: order.number, href: `/${locale}/order/${order.number}/success` },
          { label: t.title },
        ]}
      />

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-h3 text-(--color-text)">{t.title}</h1>
          <p className="text-small text-(--color-text-muted)">
            {to.orderNumber}{' '}
            <span className="font-mono text-(--color-text)" dir="ltr">
              {order.number}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <OrderStatusBadge status={order.status} locale={locale} />
          <PaymentStatusBadge status={order.paymentStatus} locale={locale} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {paid ? (
            <Alert variant="success" title={t.returnPaidTitle}>
              {t.returnPaidBody}
            </Alert>
          ) : null}

          {!paid && lastFailure && !awaitingConfirmation ? (
            <Alert variant="error" title={t.returnFailedTitle}>
              {t.returnFailedBody}
            </Alert>
          ) : null}

          {!isPaymentEnabled() ? (
            /* An honest sentence rather than a button that cannot work. */
            <Alert variant="info" title={t.unavailableTitle}>
              {t.unavailableBody}
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle as="h2">{t.attemptsTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              {attempts.length === 0 ? (
                <p className="text-small text-(--color-text-muted)">{t.noAttempts}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[24rem] text-small">
                    <thead>
                      <tr className="border-b border-(--color-border) text-start text-caption text-(--color-text-muted)">
                        <th className="py-2 text-start font-medium">{t.attemptDate}</th>
                        <th className="py-2 text-start font-medium">{t.attemptStatus}</th>
                        <th className="py-2 text-end font-medium">{t.attemptAmount}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attempts.map((attempt) => (
                        <tr
                          key={attempt.id}
                          className="border-b border-(--color-border) last:border-0"
                        >
                          <td className="py-3">{formatOrderDate(attempt.createdAt, locale)}</td>
                          <td className="py-3">
                            {/* Text, always — colour is a second signal, never
                                the only one. */}
                            <Badge variant={paymentAttemptTone(attempt.status)}>
                              {paymentAttemptLabel(attempt.status, locale)}
                            </Badge>
                          </td>
                          <td className="py-3 text-end tabular-nums">
                            {formatMoney(attempt.amountMinor, {
                              currency: attempt.currency,
                              locale,
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle as="h2">{t.statusLabel}</CardTitle>
            </CardHeader>
            <CardContent>
              {paid ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-(--color-text-muted)">{t.amountLabel}</span>
                    <span className="text-h5 tabular-nums text-(--color-text)">
                      {formatMoney(order.totalMinor, { currency: order.currency, locale })}
                    </span>
                  </div>
                  <Button asChild variant="secondary">
                    <Link href={`/${locale}/order/${order.number}/success`}>{to.viewOrder}</Link>
                  </Button>
                </div>
              ) : (
                <PaymentClient
                  locale={locale}
                  orderNumber={order.number}
                  amountMinor={order.totalMinor}
                  currency={order.currency}
                  payable={payable}
                  awaitingConfirmation={awaitingConfirmation}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
