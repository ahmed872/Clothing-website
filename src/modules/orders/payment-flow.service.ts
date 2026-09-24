import 'server-only';

import type { Order, Payment, PaymentStatus, Prisma } from '@generated/prisma';

import { AppError, db } from '@/modules/core';
import {
  applyEventWithin,
  closeAttemptWithin,
  findAttemptByReferenceWithin,
  findLiveAttempt,
  markWebhookProcessedWithin,
  orderPaymentStatusFor,
  recordWebhookDeliveryWithin,
  requirePaymentProvider,
  startAttempt,
  type VerifiedProviderEvent,
} from '@/modules/payments';
import { recordAuditEventWithin } from '@/modules/identity';

import { canTransitionOrderStatus, canTransitionPaymentStatus } from './order-status';

/**
 * The seam between an order and its money (P11 §6).
 *
 * It lives in `orders` and not in `payments` because the dependency only
 * runs one way: orders may call payments, payments may not call orders. That
 * is not bookkeeping — it is what makes it structurally impossible for a
 * payment adapter to read a price, change a total, or touch inventory. The
 * amount a provider is asked for is read here, from the stored order, and
 * handed down.
 *
 * Two entry points matter:
 *
 *   startPaymentForOrder    the customer wants to pay. Authorises, reads the
 *                           authoritative amount, opens exactly one attempt.
 *   applyVerifiedEvent      a signed provider event arrived. Deduplicates,
 *                           moves the attempt, and lets the order follow.
 *
 * Neither is reachable from the browser except through a server action or
 * the webhook route, and neither takes an amount, a currency or a status
 * from its caller's request body.
 */

/** Orders whose money we are still willing to collect. A cancelled order is
 * not payable, and a paid one is not payable again. */
const PAYABLE_ORDER_STATUSES = ['PENDING_PAYMENT', 'PENDING_MANUAL_CONFIRMATION'] as const;

export interface PayableCheck {
  payable: boolean;
  reason?: 'already_paid' | 'not_payable_status' | 'cancelled' | 'zero_total';
}

/** Structural, not `Order`: the read-only views the customer and admin
 * pages render from are projections, and every one of them carries these
 * three columns. Asking for the whole row would force a page to fetch
 * fields it has no business reading just to answer this question. */
export interface PayableOrderFacts {
  status: Order['status'];
  paymentStatus: Order['paymentStatus'];
  totalMinor: number;
}

export function assessPayable(order: PayableOrderFacts): PayableCheck {
  if (order.paymentStatus === 'PAID') return { payable: false, reason: 'already_paid' };
  if (order.status === 'CANCELLED') return { payable: false, reason: 'cancelled' };
  if (!(PAYABLE_ORDER_STATUSES as readonly string[]).includes(order.status)) {
    return { payable: false, reason: 'not_payable_status' };
  }
  if (order.totalMinor <= 0) return { payable: false, reason: 'zero_total' };
  return { payable: true };
}

export interface StartPaymentInput {
  orderId: string;
  /** Absolute URL the provider returns the customer to. Built by the caller
   * from the configured site origin — never from a request header, which a
   * client controls and which would make this an open redirect. */
  returnUrl: string;
  idempotencyKey?: string;
  actorUserId?: string | null;
}

export interface StartPaymentResult {
  payment: Payment;
  order: Order;
  reused: boolean;
}

/**
 * Opens (or reuses) the order's one live payment attempt.
 *
 * Step 3 is the point of the whole function: the amount and currency come
 * from `order.totalMinor` and `order.currency`, columns P10 wrote inside its
 * finalisation transaction after recomputing the cart server-side. Nothing
 * in this path can be influenced by what the customer's browser believes the
 * total is (P11 §7).
 */
export async function startPaymentForOrder(input: StartPaymentInput): Promise<StartPaymentResult> {
  // 1. Load the authoritative order. Authorisation is the caller's — it
  //    resolved this id from a number the reader proved they may see.
  const order = await db.order.findUnique({ where: { id: input.orderId } });
  if (!order) {
    throw new AppError('NOT_FOUND', { details: { entity: 'Order', id: input.orderId } });
  }

  // 2. Is this order still one we will take money for?
  const payable = assessPayable(order);
  if (!payable.payable) {
    throw new AppError('CONFLICT', {
      internalMessage: `Payment refused for order ${order.number}: ${payable.reason}`,
      details: { reasonCode: payable.reason },
    });
  }

  // 3. Reuse the live attempt if there is one. A customer who refreshes the
  //    provider page must land back on the same session, not a second one.
  const live = await findLiveAttempt(order.id);
  if (live && live.checkoutUrl) {
    return { payment: live, order, reused: true };
  }

  // 4. The stored total, and only the stored total.
  const { payment, reused } = await startAttempt({
    orderId: order.id,
    orderNumber: order.number,
    amountMinor: order.totalMinor,
    currency: order.currency,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    returnUrl: input.returnUrl,
    idempotencyKey: input.idempotencyKey,
  });

  // 5. The order follows the attempt. Recorded through the same transition
  //    helper every other status move uses, so the timeline and the audit
  //    log get their entries whether the mover was a person or a provider.
  const updatedOrder = await db.$transaction(async (tx) =>
    applyAttemptStatusToOrderWithin(tx, {
      order,
      to: 'PENDING',
      paymentId: payment.id,
      actorUserId: input.actorUserId ?? null,
      note: 'payment.session_opened',
    }),
  );

  return { payment, order: updatedOrder ?? order, reused };
}

/**
 * Moves `Order.paymentStatus` to follow an attempt, inside the caller's
 * transaction, and lets the order's own lifecycle follow the money.
 *
 * Returns null when the move is not one the order machine allows — which is
 * a normal outcome, not an error: an order already PAID stays PAID when a
 * duplicate success arrives, and refusing quietly is exactly right.
 */
async function applyAttemptStatusToOrderWithin(
  tx: Prisma.TransactionClient,
  args: {
    order: Order;
    to: PaymentStatus;
    paymentId: string;
    actorUserId: string | null;
    note: string;
  },
): Promise<Order | null> {
  const { order, to } = args;
  if (order.paymentStatus === to) return order;
  if (!canTransitionPaymentStatus(order.paymentStatus, to)) return null;

  const updated = await tx.order.update({
    where: { id: order.id },
    data: { paymentStatus: to },
  });

  await tx.orderEvent.create({
    data: {
      orderId: order.id,
      type: 'PAYMENT_STATUS',
      fromValue: order.paymentStatus,
      toValue: to,
      // Null actor: a provider is not a user. The note names which attempt
      // and which event caused it, which is what a support agent needs.
      actorUserId: args.actorUserId,
      note: `${args.note} (payment ${args.paymentId})`,
    },
  });

  await recordAuditEventWithin(tx, {
    action: 'order.payment_changed',
    entityType: 'Order',
    entityId: order.id,
    userId: args.actorUserId,
    before: { paymentStatus: order.paymentStatus },
    after: { paymentStatus: to, paymentId: args.paymentId },
  });

  // Money arriving is what confirms an order. Nothing else in this function
  // touches inventory, items, coupons or totals — P10 finalised the
  // commercial transaction, and this only records that it was paid for
  // (P11 §13).
  if (to === 'PAID' && canTransitionOrderStatus(updated.status, 'CONFIRMED')) {
    const confirmed = await tx.order.update({
      where: { id: order.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: 'ORDER_STATUS',
        fromValue: updated.status,
        toValue: 'CONFIRMED',
        actorUserId: null,
        note: 'payment.succeeded',
      },
    });
    await tx.outboxEvent.create({
      data: { type: 'order.confirmed', payload: { orderId: order.id, number: order.number } },
    });
    return confirmed;
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Webhook application
// ---------------------------------------------------------------------------

export type WebhookApplication =
  | { kind: 'processed'; paymentId: string; attemptStatus: string }
  | { kind: 'duplicate' }
  | { kind: 'unknown_reference' }
  | { kind: 'ignored'; reason: string }
  | { kind: 'rejected'; reason: string };

/**
 * Applies one already-verified provider event (P11 §10–§13).
 *
 * "Already verified" is enforced by the type: this function takes a
 * `VerifiedProviderEvent`, which only an adapter's `verifyWebhook` can
 * produce. There is no path from a raw request body to here that skips the
 * signature check.
 *
 * Everything below happens in one transaction: recording the delivery,
 * moving the attempt, moving the order, writing the timeline entry, the
 * audit row and the outbox event. A redelivery that arrives while this is
 * in flight loses the `(provider, external_event_id)` unique insert and is
 * told it is a duplicate — no read-then-write check, because that is
 * precisely what a concurrent redelivery defeats.
 */
export async function applyVerifiedEvent(args: {
  provider: string;
  event: VerifiedProviderEvent;
  rawPayload: unknown;
}): Promise<WebhookApplication> {
  const { provider, event } = args;

  return db.$transaction(async (tx) => {
    const attempt = await findAttemptByReferenceWithin(tx, provider, event.reference);

    const delivery = await recordWebhookDeliveryWithin(tx, {
      provider,
      externalEventId: event.externalEventId,
      eventType: event.eventType,
      signatureValid: true,
      paymentId: attempt?.id ?? null,
      payload: args.rawPayload,
    });
    if (delivery.kind === 'duplicate') return { kind: 'duplicate' } as const;

    if (!attempt) {
      // A signed event for a session this store never opened. Recorded so it
      // is visible, processed no further.
      await markWebhookProcessedWithin(tx, delivery.webhookEventId, {
        processed: false,
        error: 'unknown_reference',
      });
      return { kind: 'unknown_reference' } as const;
    }

    const outcome = await applyEventWithin(tx, { payment: attempt, event });

    if (outcome.kind === 'ignored') {
      await markWebhookProcessedWithin(tx, delivery.webhookEventId, { processed: true });
      return { kind: 'ignored', reason: outcome.reason } as const;
    }

    if (outcome.kind === 'rejected') {
      await markWebhookProcessedWithin(tx, delivery.webhookEventId, {
        processed: false,
        error: outcome.reason,
      });
      // An amount mismatch already failed the attempt inside
      // `applyEventWithin`; the order follows it down so the customer is not
      // left staring at a pending payment that will never resolve.
      if (outcome.reason === 'amount_mismatch') {
        const order = await tx.order.findUnique({ where: { id: attempt.orderId } });
        if (order) {
          await applyAttemptStatusToOrderWithin(tx, {
            order,
            to: 'FAILED',
            paymentId: attempt.id,
            actorUserId: null,
            note: 'payment.amount_mismatch',
          });
        }
      }
      return { kind: 'rejected', reason: outcome.reason } as const;
    }

    const order = await tx.order.findUnique({ where: { id: attempt.orderId } });
    if (order) {
      const to = orderPaymentStatusFor(outcome.payment.status);
      // `null` means this attempt says nothing new about the order — an
      // abandoned session on an order another attempt already paid.
      if (to && !(to === 'UNPAID' && order.paymentStatus === 'PAID')) {
        await applyAttemptStatusToOrderWithin(tx, {
          order,
          to,
          paymentId: attempt.id,
          actorUserId: null,
          note: `payment.${event.eventType}`,
        });
      }

      if (outcome.payment.status === 'SUCCEEDED') {
        await tx.outboxEvent.create({
          data: {
            type: 'payment.succeeded',
            payload: {
              orderId: order.id,
              number: order.number,
              paymentId: attempt.id,
              amountMinor: attempt.amountMinor,
              currency: attempt.currency,
            },
          },
        });
      } else if (outcome.payment.status === 'FAILED') {
        await tx.outboxEvent.create({
          data: {
            type: 'payment.failed',
            payload: {
              orderId: order.id,
              number: order.number,
              paymentId: attempt.id,
              failureCode: outcome.payment.failureCode,
            },
          },
        });
      }
    }

    await markWebhookProcessedWithin(tx, delivery.webhookEventId, { processed: true });
    return {
      kind: 'processed',
      paymentId: attempt.id,
      attemptStatus: outcome.payment.status,
    } as const;
  });
}

/**
 * Records a delivery that did not verify (P11 §10).
 *
 * Written outside the main transaction and with no payment attached: a
 * rejected delivery must leave a trace — an endpoint being probed is worth
 * seeing — but must never reach an attempt. There is deliberately no code
 * path from here into `applyEventWithin`.
 */
export async function recordRejectedDelivery(args: {
  provider: string;
  reason: string;
  eventType: string | null;
  /** Derived by the route from the raw body, so two distinct rejected bodies
   * do not collapse into one row. */
  externalEventId: string;
  rawPayload: unknown;
}): Promise<void> {
  await db.$transaction(async (tx) => {
    await recordWebhookDeliveryWithin(tx, {
      provider: args.provider,
      externalEventId: args.externalEventId,
      eventType: args.eventType ?? 'unknown',
      signatureValid: false,
      paymentId: null,
      payload: args.rawPayload,
      error: args.reason,
    });
  });
}

/**
 * Asks the provider what it actually thinks, and applies the answer (P11 §19).
 *
 * Used by the return page and by any path where a webhook's ordering is
 * ambiguous. This is the reason a customer bouncing back from the provider
 * does not need to be trusted: instead of reading a query parameter, the
 * server asks the provider directly, over an authenticated connection, and
 * believes that.
 */
export async function syncAttemptFromProvider(paymentId: string): Promise<Payment | null> {
  const provider = requirePaymentProvider();
  const attempt = await db.payment.findUnique({ where: { id: paymentId } });
  if (!attempt?.providerReference) return attempt;

  const state = await provider.retrieveSession(attempt.providerReference);
  if (!state) return attempt;

  const synthetic: VerifiedProviderEvent = {
    // Canonical lookups are keyed by the state they observed, so repeating
    // the lookup while nothing has changed does not write a second row.
    externalEventId: `lookup:${attempt.providerReference}:${state.status}`,
    eventType: 'provider.lookup',
    reference: attempt.providerReference,
    status: state.status,
    occurredAt: new Date(),
    amountMinor: Number.isNaN(state.amountMinor) ? null : state.amountMinor,
    currency: state.currency || null,
    failureCode: state.failureCode,
    failureMessage: state.failureMessage,
    metadata: state.metadata,
  };

  await applyVerifiedEvent({
    provider: attempt.provider,
    event: synthetic,
    rawPayload: state.metadata,
  });
  return db.payment.findUnique({ where: { id: paymentId } });
}

/** Ends the order's live attempt, if any. Called when an order is cancelled,
 * so a provider session cannot outlive the thing it was paying for. */
export async function closeLiveAttemptForOrderWithin(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  const live = await tx.payment.findFirst({
    where: { orderId, status: { in: ['CREATED', 'REQUIRES_ACTION', 'PENDING'] } },
  });
  if (!live) return;
  await closeAttemptWithin(tx, { paymentId: live.id, to: 'CANCELLED' });
}
