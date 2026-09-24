import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';

import { isLocale, type Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { assessPayable } from '@/modules/orders';
import { isPaymentEnabled } from '@/modules/payments';
import { resolveOrderAccess } from '@/lib/orders/order-identity';
import { OrderDetail, formatOrderDate } from '@/components/storefront/orders/order-detail';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * The order confirmation.
 *
 * Reachable only by the person who placed the order: a signed-in customer
 * through their session, a guest through the access token in their httpOnly
 * cookie. Anyone else — including someone who guessed a real order number —
 * gets a 404, which is also what a number that does not exist returns, so
 * the page cannot be used to discover which orders are real (P10 §13/§31).
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
    title: getDictionary(locale).orders.successTitle,
    robots: { index: false, follow: false },
  };
}

export default async function OrderSuccessPage({
  params,
}: {
  params: Promise<{ locale: string; number: string }>;
}) {
  const { locale: raw, number } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  const t = getDictionary(locale).orders;

  const access = await resolveOrderAccess(number);
  if (!access) notFound();

  const { order, via } = access;
  const tp = getDictionary(locale).payment;
  // Whether to offer payment is the server's call, from the stored order and
  // the deployment's configuration — never from how the visitor arrived.
  const payable = assessPayable(order).payable && isPaymentEnabled();

  return (
    <div className="container mx-auto flex flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col items-start gap-3">
        <span className="flex size-12 items-center justify-center rounded-(--radius-full) bg-(--color-success-surface)">
          <CheckCircle2 className="size-6 text-(--color-success)" aria-hidden="true" />
        </span>
        <h1 className="text-h3 text-(--color-text)">{t.successTitle}</h1>
        <p className="text-(--color-text-muted)">{t.successBody}</p>

        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-small">
          <div className="flex items-baseline gap-2">
            <dt className="text-(--color-text-muted)">{t.orderNumber}</dt>
            {/* The number is a Latin identifier: forcing LTR keeps its
                segments in the order they were issued inside an RTL page. */}
            <dd className="font-mono text-(--color-text)" dir="ltr">
              {order.number}
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-(--color-text-muted)">{t.placedAt}</dt>
            <dd className="text-(--color-text)">{formatOrderDate(order.placedAt, locale)}</dd>
          </div>
        </dl>
      </div>

      <Alert variant="info" title={t.nextStepsTitle}>
        {t.nextStepsBody}
        {via === 'guest-token' ? <span className="mt-1 block">{t.saveLinkNotice}</span> : null}
      </Alert>

      {/* The payment call to action, when there is money still to collect.
          Deliberately after the confirmation and before the line items: the
          order exists either way, and this page's first job is to say so
          (P11 §20). */}
      {payable ? (
        <Alert variant="warning" title={tp.pendingBadge}>
          <span className="mt-2 block">
            <Button asChild size="sm">
              <Link href={`/${locale}/order/${order.number}/payment`}>{tp.payNow}</Link>
            </Button>
          </span>
        </Alert>
      ) : null}

      <OrderDetail order={order} locale={locale} />

      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href={`/${locale}`}>{getDictionary(locale).cart.continueShopping}</Link>
        </Button>
        {payable ? (
          <Button asChild variant="ghost">
            <Link href={`/${locale}/order/${order.number}/payment`}>{tp.title}</Link>
          </Button>
        ) : null}
        {via === 'customer' ? (
          <Button asChild variant="ghost">
            <Link href={`/${locale}/account/orders`}>{t.myOrders}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
