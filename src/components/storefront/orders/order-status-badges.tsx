import type { FulfillmentStatus, OrderStatus, PaymentStatus } from '@generated/prisma';

import type { Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import {
  fulfillmentStatusLabel,
  fulfillmentStatusTone,
  orderStatusLabel,
  orderStatusTone,
  paymentStatusLabel,
  paymentStatusTone,
  type StatusTone,
} from '@/lib/orders/order-labels';
import { Badge } from '@/components/ui/badge';

/**
 * The three statuses, always shown together.
 *
 * Each badge carries its own text — colour is a second signal, never the
 * only one (P10 §30) — and each is preceded by a label saying which machine
 * it belongs to, so "Processing" as an order status is not mistaken for
 * "Processing" as a fulfillment status.
 */

type BadgeVariant = 'neutral' | 'success' | 'warning' | 'error' | 'info';

function toneToVariant(tone: StatusTone): BadgeVariant {
  return tone;
}

export function OrderStatusBadge({ status, locale }: { status: OrderStatus; locale: Locale }) {
  return (
    <Badge variant={toneToVariant(orderStatusTone(status))}>
      {orderStatusLabel(status, locale)}
    </Badge>
  );
}

export function PaymentStatusBadge({ status, locale }: { status: PaymentStatus; locale: Locale }) {
  return (
    <Badge variant={toneToVariant(paymentStatusTone(status))}>
      {paymentStatusLabel(status, locale)}
    </Badge>
  );
}

export function FulfillmentStatusBadge({
  status,
  locale,
}: {
  status: FulfillmentStatus;
  locale: Locale;
}) {
  return (
    <Badge variant={toneToVariant(fulfillmentStatusTone(status))}>
      {fulfillmentStatusLabel(status, locale)}
    </Badge>
  );
}

export function OrderStatusGroup({
  status,
  paymentStatus,
  fulfillmentStatus,
  locale,
}: {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  locale: Locale;
}) {
  const t = getDictionary(locale).orders;
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-3">
      <div className="flex flex-col gap-1">
        <dt className="text-caption text-(--color-text-muted)">{t.statusLabel}</dt>
        <dd>
          <OrderStatusBadge status={status} locale={locale} />
        </dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className="text-caption text-(--color-text-muted)">{t.paymentLabel}</dt>
        <dd>
          <PaymentStatusBadge status={paymentStatus} locale={locale} />
        </dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className="text-caption text-(--color-text-muted)">{t.fulfillmentLabel}</dt>
        <dd>
          <FulfillmentStatusBadge status={fulfillmentStatus} locale={locale} />
        </dd>
      </div>
    </dl>
  );
}
