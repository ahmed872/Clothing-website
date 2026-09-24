import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Payment, PaymentAttemptStatus, Prisma } from '@generated/prisma';

import { AppError, db } from '@/modules/core';

import {
  LIVE_ATTEMPT_STATUSES,
  canTransitionAttempt,
  isNewerEvent,
  isTerminalAttempt,
} from './payment-status';
import type { VerifiedProviderEvent } from './provider';
import { requirePaymentProvider } from './provider-factory';
import { redactProviderPayload } from './redaction';

/**
 * Payment attempts, and the verified events that move them.
 *
 * This module may depend on `core` and nothing else (P01's boundary graph):
 * it does not import `orders`, does not know what an order *is* beyond an id
 * and a number, and never reads a price. Everything commercial is passed in
 * by the caller, which is the order domain, which read it from the stored
 * order. That direction is the whole point — a payment cannot decide what
 * something costs.
 */

const UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown, fragment?: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== UNIQUE_VIOLATION) return false;
  if (!fragment) return true;
  const target = candidate.meta?.target;
  if (Array.isArray(target)) return target.some((entry) => String(entry).includes(fragment));
  return typeof target === 'string' ? target.includes(fragment) : false;
}

// ---------------------------------------------------------------------------
// Starting an attempt
// ---------------------------------------------------------------------------

export interface StartAttemptInput {
  orderId: string;
  orderNumber: string;
  /** Read from the stored order by the caller. Never from a request body. */
  amountMinor: number;
  currency: string;
  customerEmail: string | null;
  customerPhone: string | null;
  returnUrl: string;
  /** Optional client-supplied key for the double-click case. The database's
   * partial unique index is the real guarantee; this only makes the repeat
   * resolve to the same row instead of colliding. */
  idempotencyKey?: string;
}

export interface StartAttemptResult {
  payment: Payment;
  /** True when an existing live attempt was returned instead of a new one
   * being opened. */
  reused: boolean;
}

/**
 * Opens exactly one live payment attempt for an order (P11 §8).
 *
 * The row is written *before* the provider is called, on purpose. The
 * partial unique index `payments_one_live_attempt_per_order` is what
 * arbitrates two concurrent requests, and it can only do that if both try to
 * insert. Calling the provider first and inserting afterwards would create
 * two provider sessions and then discover the conflict, which is the
 * expensive order to find out in.
 *
 * If the provider call then fails, the attempt is marked FAILED rather than
 * left occupying the slot — a customer whose first try errored must be able
 * to try again, and an abandoned CREATED row would block them forever.
 */
export async function startAttempt(input: StartAttemptInput): Promise<StartAttemptResult> {
  const provider = requirePaymentProvider();

  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new AppError('VALIDATION_FAILED', {
      internalMessage: `Refused to open a payment for a non-positive amount (${input.amountMinor})`,
      details: { reasonCode: 'invalid_amount' },
    });
  }

  const idempotencyKey = input.idempotencyKey ?? randomUUID();

  let payment: Payment;
  try {
    payment = await db.payment.create({
      data: {
        orderId: input.orderId,
        provider: provider.name,
        status: 'CREATED',
        amountMinor: input.amountMinor,
        currency: input.currency,
        idempotencyKey,
      },
    });
  } catch (error) {
    // Either a concurrent request won the live-attempt slot, or this is the
    // same submission arriving twice. Both mean: return what already exists.
    if (isUniqueViolation(error)) {
      const existing = await findLiveAttempt(input.orderId);
      if (existing) return { payment: existing, reused: true };
      const byKey = await db.payment.findUnique({ where: { idempotencyKey } });
      if (byKey) return { payment: byKey, reused: true };
    }
    throw error;
  }

  try {
    const session = await provider.createSession({
      paymentId: payment.id,
      orderNumber: input.orderNumber,
      amountMinor: input.amountMinor,
      currency: input.currency,
      returnUrl: input.returnUrl,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      idempotencyKey,
    });

    const updated = await db.payment.update({
      where: { id: payment.id },
      data: {
        providerReference: session.reference,
        checkoutUrl: session.checkoutUrl,
        status: session.status,
        expiresAt: session.expiresAt,
        providerMetadata: session.metadata as Prisma.InputJsonValue,
      },
    });
    return { payment: updated, reused: false };
  } catch (error) {
    // Free the slot, and record why. `failureMessage` gets the AppError's
    // internal message, which by construction names a status code and a
    // path — never a credential, never a response body.
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        failureCode: 'provider_unavailable',
        // `AppError.message` is the internal message we set ourselves, which
        // by construction names a status code and a path. Any other error's
        // message could be anything, so it is not stored.
        failureMessage:
          error instanceof AppError ? error.message : 'Provider session was not created',
      },
    });
    throw error;
  }
}

/** The one live attempt for an order, if there is one. At most one can
 * exist — the database enforces it, this only reads it. */
export async function findLiveAttempt(orderId: string): Promise<Payment | null> {
  return db.payment.findFirst({
    where: { orderId, status: { in: [...LIVE_ATTEMPT_STATUSES] } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listAttemptsForOrder(orderId: string): Promise<Payment[]> {
  // Bounded: an order accumulates attempts one retry at a time, and a page
  // that renders every one of them is still a page. The cap exists so a
  // pathological order cannot make the admin screen unbounded (P11 §31).
  return db.payment.findMany({
    where: { orderId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

export async function getAttemptById(paymentId: string): Promise<Payment | null> {
  return db.payment.findUnique({ where: { id: paymentId } });
}

// ---------------------------------------------------------------------------
// Webhook ingestion
// ---------------------------------------------------------------------------

export type WebhookRecordOutcome =
  { kind: 'first_delivery'; webhookEventId: string } | { kind: 'duplicate' };

/**
 * Records a delivery, and says whether this is the first time it has been
 * seen (P11 §11).
 *
 * The uniqueness of `(provider, external_event_id)` is the entire
 * deduplication mechanism. Two concurrent redeliveries both insert; one
 * wins, the other takes the unique violation and is told it is a duplicate.
 * There is no read-then-write check anywhere, because a read-then-write
 * check is exactly what a concurrent redelivery defeats.
 */
export async function recordWebhookDeliveryWithin(
  tx: Prisma.TransactionClient,
  args: {
    provider: string;
    externalEventId: string;
    eventType: string;
    signatureValid: boolean;
    paymentId?: string | null;
    payload: unknown;
    error?: string | null;
  },
): Promise<WebhookRecordOutcome> {
  // `ON CONFLICT DO NOTHING`, not an insert wrapped in try/catch.
  //
  // That distinction is load-bearing and was found the hard way: inside a
  // Postgres transaction a constraint violation aborts the *whole*
  // transaction, so catching the error and carrying on is not something the
  // database will allow — every following statement fails with "current
  // transaction is aborted". A conflicting insert that simply does nothing
  // leaves the transaction healthy, which is what lets the duplicate check
  // and the payment transition share one atomic unit.
  //
  // Concurrency is still the database's to arbitrate: two simultaneous
  // redeliveries both insert, the second blocks on the first's uncommitted
  // row, and when the first commits the second inserts nothing and is told
  // it is a duplicate.
  const created = await tx.webhookEvent.createMany({
    data: [
      {
        provider: args.provider,
        externalEventId: args.externalEventId,
        eventType: args.eventType,
        signatureValid: args.signatureValid,
        paymentId: args.paymentId ?? null,
        // Redacted here as well as at the adapter: this is the last place
        // the payload can be written to disk, so the allowlist is applied
        // at the boundary that actually persists it.
        payload: redactProviderPayload(args.payload) as Prisma.InputJsonValue,
        attempts: 1,
        status: args.signatureValid ? 'RECEIVED' : 'FAILED',
        error: args.error ?? null,
        processedAt: args.signatureValid ? null : new Date(),
      },
    ],
    skipDuplicates: true,
  });

  if (created.count === 0) return { kind: 'duplicate' };

  const row = await tx.webhookEvent.findFirstOrThrow({
    where: { provider: args.provider, externalEventId: args.externalEventId },
    select: { id: true },
  });
  return { kind: 'first_delivery', webhookEventId: row.id };
}

export async function markWebhookProcessedWithin(
  tx: Prisma.TransactionClient,
  webhookEventId: string,
  outcome: { processed: boolean; error?: string | null },
): Promise<void> {
  await tx.webhookEvent.update({
    where: { id: webhookEventId },
    data: {
      status: outcome.processed ? 'PROCESSED' : 'FAILED',
      error: outcome.error ?? null,
      processedAt: new Date(),
    },
  });
}

/**
 * Finds — and locks — the attempt a verified event refers to.
 *
 * The `FOR UPDATE` is not incidental. Without it, two provider events
 * arriving at once both read the same unlocked row, both see the same
 * pre-transition state, both pass the terminal/stale guards, and the last
 * write wins — which lets a delayed PENDING overwrite a SUCCEEDED that
 * committed microseconds earlier. Written first without the lock, and caught
 * by the concurrency test that delivers exactly that pair in parallel.
 *
 * The lock serialises the two transactions on the payment row, so the second
 * one re-reads the first one's committed result and its guards then have
 * something true to guard against.
 *
 * Returns null rather than throwing: an event for a session this store never
 * opened is a rejection to record, not a crash.
 */
export async function findAttemptByReferenceWithin(
  tx: Prisma.TransactionClient,
  provider: string,
  reference: string,
): Promise<Payment | null> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM payments
    WHERE provider = ${provider}::"PaymentProvider" AND provider_reference = ${reference}
    FOR UPDATE
  `;
  const id = locked[0]?.id;
  if (!id) return null;
  // Read back through Prisma so the caller gets a fully typed row; the lock
  // is already held, so this cannot see anything but the locked state.
  return tx.payment.findUnique({ where: { id } });
}

// ---------------------------------------------------------------------------
// Applying a verified event to an attempt
// ---------------------------------------------------------------------------

export type ApplyEventOutcome =
  | { kind: 'applied'; payment: Payment; from: PaymentAttemptStatus }
  /** The event told us nothing new — same status, or an older event arriving
   * after a newer one. Not an error, and not a side effect. */
  | { kind: 'ignored'; payment: Payment; reason: 'stale' | 'no_change' | 'terminal' }
  | { kind: 'rejected'; payment: Payment; reason: 'amount_mismatch' | 'illegal_transition' };

/**
 * Moves one attempt, inside the caller's transaction (P11 §12).
 *
 * Three guards, each of which is a real failure mode a payment provider will
 * eventually produce:
 *
 *   terminal   — a settled attempt never moves again. A duplicate SUCCEEDED
 *                arriving after the first is ignored, not re-applied, which
 *                is what stops a second order transition.
 *   stale      — an event older than the last one applied is dropped. A
 *                retried PENDING landing after SUCCEEDED must not walk the
 *                payment backwards.
 *   amount     — the provider's amount must equal what we asked for. A
 *                mismatch is refused rather than reconciled: if the two
 *                disagree, the safe answer is to not mark it paid.
 */
export async function applyEventWithin(
  tx: Prisma.TransactionClient,
  args: { payment: Payment; event: VerifiedProviderEvent },
): Promise<ApplyEventOutcome> {
  const { payment, event } = args;

  if (isTerminalAttempt(payment.status)) {
    return { kind: 'ignored', payment, reason: 'terminal' };
  }

  if (!isNewerEvent(payment.lastEventAt, event.occurredAt)) {
    return { kind: 'ignored', payment, reason: 'stale' };
  }

  if (payment.status === event.status) {
    // Still record that we have seen a newer event, so the ordering guard
    // keeps working; nothing else changes.
    const touched = await tx.payment.update({
      where: { id: payment.id },
      data: { lastEventAt: event.occurredAt },
    });
    return { kind: 'ignored', payment: touched, reason: 'no_change' };
  }

  // The provider does not get to change what the order costs. A currency or
  // amount that disagrees with the attempt is a reconciliation incident, and
  // the correct behaviour is to refuse it — never to trust the larger, the
  // smaller, or the more recent number (P11 §7).
  const amountDisagrees =
    (event.amountMinor !== null && event.amountMinor !== payment.amountMinor) ||
    (event.currency !== null && event.currency.toUpperCase() !== payment.currency.toUpperCase());
  if (amountDisagrees) {
    const flagged = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        lastEventAt: event.occurredAt,
        failureCode: 'amount_mismatch',
        failureMessage: `Provider reported ${event.amountMinor} ${event.currency}; attempt is ${payment.amountMinor} ${payment.currency}`,
      },
    });
    return { kind: 'rejected', payment: flagged, reason: 'amount_mismatch' };
  }

  if (!canTransitionAttempt(payment.status, event.status)) {
    return { kind: 'rejected', payment, reason: 'illegal_transition' };
  }

  const now = new Date();
  const updated = await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: event.status,
      lastEventAt: event.occurredAt,
      providerMetadata: event.metadata as Prisma.InputJsonValue,
      failureCode: event.failureCode,
      failureMessage: event.failureMessage,
      ...(event.status === 'SUCCEEDED' ? { paidAt: now } : {}),
      ...(event.status === 'FAILED' ? { failedAt: now } : {}),
      ...(event.status === 'CANCELLED' ? { cancelledAt: now } : {}),
    },
  });

  return { kind: 'applied', payment: updated, from: payment.status };
}

/**
 * Ends a live attempt from our side — the customer abandoned it, or the
 * order was cancelled. Idempotent: an attempt that is already terminal is
 * returned unchanged rather than refused, because "make sure this is not
 * live" is the caller's actual intent.
 */
export async function closeAttemptWithin(
  tx: Prisma.TransactionClient,
  args: { paymentId: string; to: Extract<PaymentAttemptStatus, 'CANCELLED' | 'EXPIRED'> },
): Promise<Payment | null> {
  const payment = await tx.payment.findUnique({ where: { id: args.paymentId } });
  if (!payment) return null;
  if (isTerminalAttempt(payment.status)) return payment;
  if (!canTransitionAttempt(payment.status, args.to)) return payment;

  return tx.payment.update({
    where: { id: args.paymentId },
    data: {
      status: args.to,
      ...(args.to === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
    },
  });
}
