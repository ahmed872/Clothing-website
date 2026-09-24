import type {
  FulfillmentStatus,
  OrderEventType,
  OrderStatus,
  PaymentStatus,
} from '@generated/prisma';

import { getDictionary } from '@/lib/i18n/dictionary';
import type { Locale } from '@/lib/i18n/locales';

/**
 * Status labels and their visual tone, in one place.
 *
 * Two things live together here on purpose. A status must never be
 * communicated by colour alone (P10 §30) — every badge carries its text — and
 * the mapping from a database enum to that text has to be exhaustive, which
 * `Record<Enum, …>` makes the compiler check. Adding a status to the schema
 * without translating it stops being possible.
 */

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

export function orderStatusLabel(status: OrderStatus, locale: Locale): string {
  const t = getDictionary(locale).orders;
  const labels: Record<OrderStatus, string> = {
    PENDING_PAYMENT: t.statusPendingPayment,
    PENDING_MANUAL_CONFIRMATION: t.statusPendingManual,
    CONFIRMED: t.statusConfirmed,
    PROCESSING: t.statusProcessing,
    COMPLETED: t.statusCompleted,
    CANCELLED: t.statusCancelled,
  };
  return labels[status];
}

export function orderStatusTone(status: OrderStatus): StatusTone {
  const tones: Record<OrderStatus, StatusTone> = {
    PENDING_PAYMENT: 'warning',
    PENDING_MANUAL_CONFIRMATION: 'warning',
    CONFIRMED: 'info',
    PROCESSING: 'info',
    COMPLETED: 'success',
    CANCELLED: 'neutral',
  };
  return tones[status];
}

export function paymentStatusLabel(status: PaymentStatus, locale: Locale): string {
  const t = getDictionary(locale).orders;
  const labels: Record<PaymentStatus, string> = {
    UNPAID: t.paymentUnpaid,
    PENDING: t.paymentPending,
    PAID: t.paymentPaid,
    FAILED: t.paymentFailed,
    REFUNDED: t.paymentRefunded,
    PARTIALLY_REFUNDED: t.paymentPartiallyRefunded,
  };
  return labels[status];
}

export function paymentStatusTone(status: PaymentStatus): StatusTone {
  const tones: Record<PaymentStatus, StatusTone> = {
    UNPAID: 'warning',
    PENDING: 'info',
    PAID: 'success',
    FAILED: 'error',
    REFUNDED: 'neutral',
    PARTIALLY_REFUNDED: 'neutral',
  };
  return tones[status];
}

export function fulfillmentStatusLabel(status: FulfillmentStatus, locale: Locale): string {
  const t = getDictionary(locale).orders;
  const labels: Record<FulfillmentStatus, string> = {
    UNFULFILLED: t.fulfillmentUnfulfilled,
    PROCESSING: t.fulfillmentProcessing,
    SHIPPED: t.fulfillmentShipped,
    DELIVERED: t.fulfillmentDelivered,
    CANCELLED: t.fulfillmentCancelled,
  };
  return labels[status];
}

export function fulfillmentStatusTone(status: FulfillmentStatus): StatusTone {
  const tones: Record<FulfillmentStatus, StatusTone> = {
    UNFULFILLED: 'neutral',
    PROCESSING: 'info',
    SHIPPED: 'info',
    DELIVERED: 'success',
    CANCELLED: 'neutral',
  };
  return tones[status];
}

export function orderEventLabel(type: OrderEventType, locale: Locale): string {
  const t = getDictionary(locale).orders;
  const labels: Record<OrderEventType, string> = {
    CREATED: t.eventCreated,
    ORDER_STATUS: t.eventOrderStatus,
    PAYMENT_STATUS: t.eventPaymentStatus,
    FULFILLMENT_STATUS: t.eventFulfillmentStatus,
    NOTE: t.eventNote,
  };
  return labels[type];
}

/**
 * Translates a timeline entry's raw enum value.
 *
 * The column is a string because one timeline carries three machines
 * (`OrderEvent.fromValue`/`toValue`), so the type has to be recovered from
 * the event type before the value can be named in the reader's language.
 */
export function orderEventValueLabel(
  type: OrderEventType,
  value: string | null,
  locale: Locale,
): string | null {
  if (!value) return null;
  switch (type) {
    case 'CREATED':
    case 'ORDER_STATUS':
      return orderStatusLabel(value as OrderStatus, locale);
    case 'PAYMENT_STATUS':
      return paymentStatusLabel(value as PaymentStatus, locale);
    case 'FULFILLMENT_STATUS':
      return fulfillmentStatusLabel(value as FulfillmentStatus, locale);
    default:
      return null;
  }
}
