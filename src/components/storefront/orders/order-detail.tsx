import type { OrderView } from '@/modules/orders';
import { formatMoney } from '@/modules/core';
import type { Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { OrderStatusGroup } from './order-status-badges';

/**
 * One order, rendered the same way wherever a customer sees it — on the
 * success page and in their account. The admin screen renders more (timeline,
 * customer record, actions) but reads the same snapshot.
 *
 * Everything on this page comes from `OrderItem`'s snapshot columns, never
 * from the live product: a renamed or deleted product must not change what an
 * old order says it was (P10 §3).
 */

export interface OrderDetailProps {
  order: OrderView;
  locale: Locale;
}

/**
 * Dates are formatted with an explicit Latin numbering system so an Arabic
 * page shows `02/09/2026` rather than Eastern Arabic digits, matching the
 * prices and order numbers beside them (ADR-023).
 */
export function formatOrderDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn-ca-gregory`, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function OrderDetail({ order, locale }: OrderDetailProps) {
  const t = getDictionary(locale).orders;
  const tc = getDictionary(locale).checkout;
  const money = (minor: number) => formatMoney(minor, { currency: order.currency, locale });
  const address = order.shippingAddress;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {/* `min-w-0` is load-bearing, not decoration: a grid item's default
          `min-width: auto` refuses to shrink below its content, so the
          `min-w-[28rem]` items table below stretched this column to 448px
          inside a 390px viewport and the whole page scrolled sideways —
          the `overflow-x-auto` wrapper never engaged because the container
          had already grown to fit. Zeroing the minimum lets the column take
          the viewport's width and the table scroll inside it instead. */}
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle as="h2">{t.itemsTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* A table, so a screen reader announces each cell with its
                column — and wrapped, so a narrow phone scrolls the table
                rather than the page (P10 §29). */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-small">
                <thead>
                  <tr className="border-b border-(--color-border) text-start text-caption text-(--color-text-muted)">
                    <th scope="col" className="py-2 text-start font-medium">
                      {tc.itemsTitle}
                    </th>
                    <th scope="col" className="py-2 text-start font-medium">
                      SKU
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      {tc.quantityLabel}
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      {tc.total}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id} className="border-b border-(--color-border) last:border-0">
                      <td className="py-3">
                        <span className="block text-(--color-text)">
                          {locale === 'ar' ? item.productNameAr : item.productNameEn}
                        </span>
                        {(locale === 'ar' ? item.variantLabelAr : item.variantLabelEn) ? (
                          <span className="block text-caption text-(--color-text-muted)">
                            {locale === 'ar' ? item.variantLabelAr : item.variantLabelEn}
                          </span>
                        ) : null}
                      </td>
                      {/* SKUs are Latin identifiers and must not be reordered
                          by the surrounding RTL paragraph direction. */}
                      <td
                        className="py-3 font-mono text-caption text-(--color-text-muted)"
                        dir="ltr"
                      >
                        {item.sku}
                      </td>
                      <td className="py-3 text-end tabular-nums">{item.quantity}</td>
                      <td className="py-3 text-end tabular-nums">{money(item.lineTotalMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">{t.shippingAddress}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-small text-(--color-text)">
            {address ? (
              <>
                <span>{address.fullName}</span>
                <span dir="ltr" className="text-(--color-text-muted)">
                  {address.phone}
                </span>
                <span className="text-(--color-text-muted)">
                  {address.street}
                  {address.buildingNumber ? ` ${address.buildingNumber}` : ''}
                </span>
                <span className="text-(--color-text-muted)">
                  {address.district}، {address.city}
                </span>
                {address.postalCode ? (
                  <span className="text-(--color-text-muted)" dir="ltr">
                    {address.postalCode}
                  </span>
                ) : null}
                {address.notes ? (
                  <span className="text-(--color-text-muted)">{address.notes}</span>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>

        {order.note ? (
          <Card>
            <CardHeader>
              <CardTitle as="h2">{t.orderNote}</CardTitle>
            </CardHeader>
            <CardContent className="text-small text-(--color-text-muted)">{order.note}</CardContent>
          </Card>
        ) : null}
      </div>

      <aside className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle as="h2">{tc.summarySection}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <OrderStatusGroup
              status={order.status}
              paymentStatus={order.paymentStatus}
              fulfillmentStatus={order.fulfillmentStatus}
              locale={locale}
            />

            <dl className="flex flex-col gap-2 border-t border-(--color-border) pt-4 text-small">
              <div className="flex items-center justify-between">
                <dt className="text-(--color-text-muted)">{tc.subtotal}</dt>
                <dd className="tabular-nums">{money(order.subtotalMinor)}</dd>
              </div>
              {order.discountMinor > 0 ? (
                <div className="flex items-center justify-between">
                  <dt className="text-(--color-text-muted)">
                    {tc.discount}
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
              <div className="flex items-center justify-between">
                <dt className="text-(--color-text-muted)">{tc.shipping}</dt>
                <dd className="tabular-nums">{money(order.shippingMinor)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-(--color-text-muted)">{tc.tax}</dt>
                <dd className="tabular-nums">{money(order.taxMinor)}</dd>
              </div>
              <div className="flex items-center justify-between border-t border-(--color-border) pt-2 text-body font-semibold">
                <dt>{tc.total}</dt>
                <dd className="tabular-nums">{money(order.totalMinor)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">{t.contactDetails}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-small text-(--color-text-muted)">
            {order.contactName ? <span>{order.contactName}</span> : null}
            {order.customerEmail ? <span dir="ltr">{order.customerEmail}</span> : null}
            {order.customerPhone ? <span dir="ltr">{order.customerPhone}</span> : null}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
