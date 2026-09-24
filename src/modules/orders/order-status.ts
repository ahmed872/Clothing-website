import type { FulfillmentStatus, OrderStatus, PaymentStatus } from '@generated/prisma';

/**
 * Three state machines, not one (P10 §9).
 *
 * An order that is paid, cancelled and refunded has to say all three things
 * at once, which one column cannot do. So the lifecycle, the money and the
 * shipment each get their own status and their own allowed transitions:
 *
 *   OrderStatus        where the order is commercially
 *   PaymentStatus      whether the money arrived — P11 owns every move
 *   FulfillmentStatus  where the goods are
 *
 * Everything here is pure, with no imports beyond types. That is deliberate
 * and load-bearing: the admin's action panel is a client component and needs
 * these predicates to decide which buttons to show, so this file must not
 * pull anything `server-only` into the browser bundle. The helper that
 * *throws* on a refused transition lives in `order.service.ts` with the rest
 * of the server code, because the error type it raises is server-side.
 *
 * It decides what is allowed; `order.service.ts` decides what actually
 * happens, records it, and does so in a transaction. Keeping the rules
 * separate from the writes is what lets every edge be unit-tested without a
 * database.
 */

/** Terminal states have no outgoing transitions at all. */
export const ORDER_STATUS_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  // Online checkout lands here: the order exists, the money does not.
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  // WhatsApp and admin-created orders land here instead (ADR-025).
  PENDING_MANUAL_CONFIRMATION: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['COMPLETED', 'CANCELLED'],
  // Terminal. A completed order that needs unwinding is a refund (P11), not
  // a status change — the goods already reached the customer.
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * The order's money state — a roll-up across every payment attempt, which is
 * a different question from what happened to one session (that is
 * `payments/payment-status.ts`).
 *
 * P10 only ever wrote UNPAID. As of P11 every move out of it is driven by a
 * verified provider event or by an attempt ending from our side; no route,
 * action or button writes this column directly.
 */
export const PAYMENT_STATUS_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> =
  {
    UNPAID: ['PENDING', 'PAID', 'FAILED'],
    // UNPAID is reachable again from PENDING, added in P11: a customer who
    // opens a provider session and then closes the tab leaves the order with
    // an open PENDING it will never resolve. The session expires or is
    // cancelled, and the order has to become payable again — going to FAILED
    // instead would record a decline that never happened.
    PENDING: ['PAID', 'FAILED', 'UNPAID'],
    PAID: ['REFUNDED', 'PARTIALLY_REFUNDED'],
    FAILED: ['PENDING', 'UNPAID'],
    PARTIALLY_REFUNDED: ['REFUNDED'],
    REFUNDED: [],
  };

export const FULFILLMENT_STATUS_TRANSITIONS: Readonly<
  Record<FulfillmentStatus, readonly FulfillmentStatus[]>
> = {
  UNFULFILLED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  // Terminal: goods that arrived come back as a return, which is its own
  // movement with its own inventory reason, not a reverse transition.
  DELIVERED: [],
  CANCELLED: [],
};

/** Statuses from which a customer or an admin may still cancel. Past
 * PROCESSING the store has committed real work to the order, so cancelling
 * becomes an admin decision expressed as a refund in P11. */
export const CANCELLABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  'PENDING_PAYMENT',
  'PENDING_MANUAL_CONFIRMATION',
  'CONFIRMED',
  'PROCESSING',
];

/** Statuses at which stock has been taken out of the warehouse for this
 * order. Every P10 order reaches one of these the moment it is created —
 * the list exists so cancellation knows whether there is anything to give
 * back, rather than assuming. */
export const STOCK_CONSUMED_ORDER_STATUSES: readonly OrderStatus[] = [
  'PENDING_PAYMENT',
  'PENDING_MANUAL_CONFIRMATION',
  'CONFIRMED',
  'PROCESSING',
  'COMPLETED',
];

export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

export function canTransitionPaymentStatus(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_STATUS_TRANSITIONS[from].includes(to);
}

export function canTransitionFulfillmentStatus(
  from: FulfillmentStatus,
  to: FulfillmentStatus,
): boolean {
  return FULFILLMENT_STATUS_TRANSITIONS[from].includes(to);
}

export function isOrderCancellable(status: OrderStatus): boolean {
  return CANCELLABLE_ORDER_STATUSES.includes(status);
}

export function hasConsumedStock(status: OrderStatus): boolean {
  return STOCK_CONSUMED_ORDER_STATUSES.includes(status);
}
