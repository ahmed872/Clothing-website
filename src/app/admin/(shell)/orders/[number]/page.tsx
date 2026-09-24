import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import { getOrderForAdmin } from '@/modules/orders';
import { isPaymentEnabled, listAttemptsForOrder } from '@/modules/payments';
import { paymentAttemptLabel, paymentAttemptTone } from '@/lib/payments/payment-labels';
import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/modules/core';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { orderEventLabel, orderEventValueLabel } from '@/lib/orders/order-labels';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { formatAdminDate } from '@/lib/admin/format-admin-date';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { OrderActionsPanel } from '@/components/admin/order-actions-panel';
import { OrderStatusGroup } from '@/components/storefront/orders/order-status-badges';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Order' };

/**
 * One order, for an operator.
 *
 * Shows the immutable snapshot — the names, SKUs and prices as they were when
 * the order was placed — beside the mutable statuses and the timeline of who
 * changed them. Reading the live catalog here would let a later rename
 * quietly rewrite what the store agreed to sell (P10 §3/§16).
 */
export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  await requireAdminPermission('orders.read');

  const { number } = await params;
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);
  const to = t.ordersAdmin;

  const order = await getOrderForAdmin(number);
  if (!order) notFound();

  // Bounded by `listAttemptsForOrder`'s own `take`; one query, no N+1 —
  // the attempts are read once here, not per row (P11 §31).
  const attempts = await listAttemptsForOrder(order.id);

  const money = (minor: number) => formatMoney(minor, { currency: order.currency, locale });
  const address = order.shippingAddress;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={order.number}
        description={formatAdminDate(order.placedAt, locale)}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[{ label: to.title, href: '/admin/orders' }, { label: order.number }]}
          />
        }
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/orders">{to.backToList}</Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* See the same note in `order-detail.tsx`: without `min-w-0` a grid
            item will not shrink below its content, and the items table drags
            the whole page into a horizontal scroll on a phone. */}
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">{t.products.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{to.colItems}</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-end">{t.inventory.colStock}</TableHead>
                      <TableHead className="text-end">{to.colTotal}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <span className="block text-(--color-text)">
                            {locale === 'ar' ? item.productNameAr : item.productNameEn}
                          </span>
                          {(locale === 'ar' ? item.variantLabelAr : item.variantLabelEn) ? (
                            <span className="block text-caption text-(--color-text-muted)">
                              {locale === 'ar' ? item.variantLabelAr : item.variantLabelEn}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="font-mono text-caption" dir="ltr">
                          {item.sku}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">{item.quantity}</TableCell>
                        <TableCell className="text-end tabular-nums">
                          {money(item.lineTotalMinor)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">{to.timeline}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-4">
                {order.timeline.map((entry) => {
                  const from = orderEventValueLabel(entry.type, entry.fromValue, locale);
                  const value = orderEventValueLabel(entry.type, entry.toValue, locale);
                  return (
                    <li key={entry.id} className="flex gap-3">
                      <span
                        className="mt-1.5 size-2 flex-none rounded-(--radius-full) bg-(--color-border-strong)"
                        aria-hidden="true"
                      />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-small text-(--color-text)">
                          {orderEventLabel(entry.type, locale)}
                          {value ? (
                            <>
                              {' — '}
                              {from ? `${from} → ` : ''}
                              <span className="font-medium">{value}</span>
                            </>
                          ) : null}
                        </span>
                        <span className="text-caption text-(--color-text-muted)">
                          {formatAdminDate(entry.createdAt, locale)}
                          {' · '}
                          {entry.actor
                            ? (entry.actor.name ?? entry.actor.email)
                            : getAdminDictionary(locale).ordersAdmin.guest}
                        </span>
                        {entry.note ? (
                          <span className="text-caption text-(--color-text-muted)">
                            {entry.note}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        </div>

        {/* A plain column, not an `<aside>`: the admin shell's navigation is
            already the page's one `complementary` landmark, and a second
            unnamed one makes both ambiguous to a screen reader (axe's
            `landmark-unique`). This is a layout column, not standalone
            supporting content. */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle as="h2">{to.actions}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <OrderStatusGroup
                status={order.status}
                paymentStatus={order.paymentStatus}
                fulfillmentStatus={order.fulfillmentStatus}
                locale={locale}
              />
              <OrderActionsPanel
                number={order.number}
                status={order.status}
                fulfillmentStatus={order.fulfillmentStatus}
                locale={locale}
              />
              {/* The payment boundary, stated where an operator would look
                  for a "mark as paid" button and not find one (P10 §11). */}
              <Alert variant="info" title={to.paymentBoundaryTitle}>
                {to.paymentBoundaryBody}
              </Alert>
            </CardContent>
          </Card>

          {/* Payment, read-only. There is no control here that moves money:
              a payment becomes PAID from a verified provider event and from
              nothing else, and a refund is an operation against the provider
              that this phase does not perform (P11 §21/§22). */}
          <Card>
            <CardHeader>
              <CardTitle as="h2">{to.paymentTitle}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {!isPaymentEnabled() ? (
                <p className="text-small text-(--color-text-muted)">{to.paymentDisabled}</p>
              ) : null}

              {attempts.length === 0 ? (
                <p className="text-small text-(--color-text-muted)">{to.paymentNoAttempts}</p>
              ) : (
                <ol className="flex flex-col gap-4">
                  {attempts.map((attempt) => (
                    <li
                      key={attempt.id}
                      className="flex flex-col gap-1.5 border-b border-(--color-border) pb-4 last:border-0 last:pb-0"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Badge variant={paymentAttemptTone(attempt.status)}>
                          {paymentAttemptLabel(attempt.status, locale)}
                        </Badge>
                        <span className="tabular-nums text-small text-(--color-text)">
                          {money(attempt.amountMinor)}
                        </span>
                      </div>
                      <dl className="flex flex-col gap-1 text-caption text-(--color-text-muted)">
                        <div className="flex justify-between gap-3">
                          <dt>{to.paymentProvider}</dt>
                          <dd dir="ltr">{attempt.provider}</dd>
                        </div>
                        {attempt.providerReference ? (
                          <div className="flex min-w-0 justify-between gap-3">
                            <dt className="flex-none">{to.paymentReference}</dt>
                            {/* A Latin identifier: forced LTR so its
                                segments read in issue order inside an
                                Arabic page. Truncated, not wrapped, so a
                                long reference cannot widen the column. */}
                            <dd className="truncate font-mono" dir="ltr">
                              {attempt.providerReference}
                            </dd>
                          </div>
                        ) : null}
                        <div className="flex justify-between gap-3">
                          <dt>{to.paymentCreated}</dt>
                          <dd>{formatAdminDate(attempt.createdAt, locale)}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt>{to.paymentUpdated}</dt>
                          <dd>{formatAdminDate(attempt.updatedAt, locale)}</dd>
                        </div>
                        {attempt.failureCode ? (
                          <div className="flex justify-between gap-3">
                            <dt>{to.paymentFailure}</dt>
                            {/* The provider's own decline code. Never a
                                secret, never a raw payload. */}
                            <dd className="text-(--color-error)" dir="ltr">
                              {attempt.failureCode}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    </li>
                  ))}
                </ol>
              )}

              <Alert variant="info" title={to.paymentBoundaryRefundTitle}>
                {to.paymentBoundaryRefundBody}
              </Alert>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">{to.colTotal}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-2 text-small">
                <div className="flex items-center justify-between">
                  <dt className="text-(--color-text-muted)">{t.pricing.colPrice}</dt>
                  <dd className="tabular-nums">{money(order.subtotalMinor)}</dd>
                </div>
                {order.discountMinor > 0 ? (
                  <div className="flex items-center justify-between">
                    <dt className="text-(--color-text-muted)">
                      {t.promotions.title}
                      {order.couponCode ? (
                        <span className="ms-1 font-mono text-caption" dir="ltr">
                          ({order.couponCode})
                        </span>
                      ) : null}
                    </dt>
                    <dd className="tabular-nums text-(--color-success)">
                      −{money(order.discountMinor)}
                    </dd>
                  </div>
                ) : null}
                <div className="flex items-center justify-between border-t border-(--color-border) pt-2 font-semibold">
                  <dt>{to.colTotal}</dt>
                  <dd className="tabular-nums">{money(order.totalMinor)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">{to.colCustomer}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-small text-(--color-text-muted)">
              {order.contactName ? (
                <span className="text-(--color-text)">{order.contactName}</span>
              ) : null}
              {order.customerEmail ? <span dir="ltr">{order.customerEmail}</span> : null}
              {order.customerPhone ? <span dir="ltr">{order.customerPhone}</span> : null}
              <span className="text-caption text-(--color-text-subtle)">
                {order.customer ? to.customerRecord : to.guest}
              </span>

              {address ? (
                <div className="mt-3 flex flex-col gap-0.5 border-t border-(--color-border) pt-3">
                  <span className="text-(--color-text)">{address.fullName}</span>
                  <span>
                    {address.street} {address.buildingNumber}
                  </span>
                  <span>
                    {address.district}، {address.city}
                  </span>
                  {address.postalCode ? <span dir="ltr">{address.postalCode}</span> : null}
                  {address.notes ? <span>{address.notes}</span> : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {order.cancelledAt && order.cancellationReason ? (
            <Alert variant="warning" title={to.cancelled}>
              {order.cancellationReason}
            </Alert>
          ) : null}
        </div>
      </div>
    </div>
  );
}
