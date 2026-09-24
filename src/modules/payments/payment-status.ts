import type { PaymentAttemptStatus, PaymentStatus } from '@generated/prisma';

/**
 * The attempt state machine, and how one attempt's outcome becomes the
 * order's money state (P11 §3).
 *
 * Two machines, deliberately. `Order.paymentStatus` answers "has this order
 * been paid" — a roll-up across every attempt, owned by the order domain and
 * unchanged since P10. This file owns "what happened to this session", which
 * is a different question with different terminal states: an order can hold a
 * FAILED attempt and a SUCCEEDED one at the same time, and `UNPAID` is
 * meaningless for a row that exists precisely because somebody tried.
 *
 * Pure, with no imports beyond types — same rule as `order-status.ts`, for
 * the same reason: the checkout and admin components are client components
 * and need these predicates to decide what to offer, so nothing `server-only`
 * may be reachable from here.
 *
 * Who may drive what:
 *
 *   CREATED            internal — `startPayment`, after the order is authorised
 *   REQUIRES_ACTION    provider — verified webhook only
 *   PENDING            provider — verified webhook only
 *   SUCCEEDED          provider — verified webhook, or a canonical provider
 *                      lookup. Never a browser redirect, never an admin button.
 *   FAILED             provider — verified webhook or canonical lookup
 *   CANCELLED          internal — the customer abandons, or the store cancels
 *                      the order
 *   EXPIRED            internal — the session outlived `expiresAt`
 */

export const PAYMENT_ATTEMPT_TRANSITIONS: Readonly<
  Record<PaymentAttemptStatus, readonly PaymentAttemptStatus[]>
> = {
  CREATED: ['REQUIRES_ACTION', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  // The customer is at the provider doing 3-D Secure or entering an OTP. It
  // can still end any way, including straight to SUCCEEDED.
  REQUIRES_ACTION: ['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  // The provider has it. Cancelling from here is not offered: the money may
  // already be moving, and only the provider knows.
  PENDING: ['SUCCEEDED', 'FAILED', 'EXPIRED'],
  // Terminal, all four. Unwinding a successful payment is a refund, which is
  // its own operation against the provider — not a reverse transition.
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
};

/** Attempts that still occupy the "one live attempt per order" slot. Kept in
 * lockstep with the partial unique index in the P11 migration — a test
 * asserts the two agree, because a silent drift would let a second live
 * attempt exist. */
export const LIVE_ATTEMPT_STATUSES: readonly PaymentAttemptStatus[] = [
  'CREATED',
  'REQUIRES_ACTION',
  'PENDING',
];

export const TERMINAL_ATTEMPT_STATUSES: readonly PaymentAttemptStatus[] = [
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
];

export function canTransitionAttempt(
  from: PaymentAttemptStatus,
  to: PaymentAttemptStatus,
): boolean {
  return PAYMENT_ATTEMPT_TRANSITIONS[from].includes(to);
}

export function isLiveAttempt(status: PaymentAttemptStatus): boolean {
  return LIVE_ATTEMPT_STATUSES.includes(status);
}

export function isTerminalAttempt(status: PaymentAttemptStatus): boolean {
  return TERMINAL_ATTEMPT_STATUSES.includes(status);
}

/**
 * What one attempt's status means for the order's money state.
 *
 * `null` means "this attempt says nothing new about the order" — the caller
 * leaves `Order.paymentStatus` alone rather than inventing a move. That is
 * the honest answer for CANCELLED and EXPIRED when the order already has a
 * successful payment from another attempt.
 */
export function orderPaymentStatusFor(status: PaymentAttemptStatus): PaymentStatus | null {
  switch (status) {
    case 'CREATED':
    case 'REQUIRES_ACTION':
    case 'PENDING':
      return 'PENDING';
    case 'SUCCEEDED':
      return 'PAID';
    case 'FAILED':
      return 'FAILED';
    // An abandoned or expired session is not a decline: nobody said no, the
    // customer walked away. The order goes back to unpaid so it can be paid
    // again, rather than wearing a failure it never had.
    case 'CANCELLED':
    case 'EXPIRED':
      return 'UNPAID';
  }
}

/**
 * Whether an incoming provider event is newer than what has already been
 * applied to this attempt (P11 §12).
 *
 * Providers retry, and retries arrive out of order: a PENDING delivered
 * twice can land after the SUCCEEDED that followed it. Comparing the
 * provider's own event timestamp against the last one applied is what stops
 * a stale event from walking a paid attempt backwards. An attempt that has
 * never seen an event accepts the first one.
 */
export function isNewerEvent(lastEventAt: Date | null, incomingAt: Date): boolean {
  if (!lastEventAt) return true;
  return incomingAt.getTime() > lastEventAt.getTime();
}
