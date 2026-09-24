import type { PaymentAttemptStatus } from '@generated/prisma';

/**
 * The one interface every payment backend implements (P11 §4).
 *
 * `payment.service.ts` and the order domain talk to `PaymentProviderAdapter`
 * and never to a vendor SDK, so adding Tap, Paymob or Stripe means writing
 * one file here and one enum value — no change to `Order`, to checkout, to
 * the webhook route, or to any test that is not about that vendor's wire
 * format. That isolation is the actual deliverable of this phase; the
 * adapter that ships with it is one instance of it.
 *
 * Everything on this interface is server-side. Nothing here is importable
 * from a client component, and no method takes a value the browser supplied:
 * `createSession` is handed an amount and currency the caller has already
 * read from the stored order (P11 §7).
 */

/** Money is always minor units — halalas for SAR — matching `Order.totalMinor`.
 * A provider that wants decimals converts at its own edge, never here. */
export interface CreateSessionInput {
  /** Our attempt id. Sent to the provider as its idempotency key and echoed
   * back on its events, which is how a webhook finds the attempt again. */
  paymentId: string;
  /** Our order number, for the provider's dashboard and the customer's
   * statement. Not a credential. */
  orderNumber: string;
  amountMinor: number;
  currency: string;
  /** Where the provider sends the customer afterwards. Informational only —
   * the return page never decides the outcome (P11 §19). */
  returnUrl: string;
  customerEmail: string | null;
  customerPhone: string | null;
  /** Provider-side idempotency, distinct from our own database guard. */
  idempotencyKey: string;
}

export interface ProviderSession {
  /** The provider's id for this session. Stored on `Payment.providerReference`. */
  reference: string;
  /** Where to send the customer. Always provider-issued. */
  checkoutUrl: string;
  status: PaymentAttemptStatus;
  expiresAt: Date | null;
  /** Already redacted by the adapter — allowlisted keys only. */
  metadata: Record<string, unknown>;
}

/** The canonical, server-side truth about a session, used when a webhook's
 * ordering is ambiguous or a customer returns and we need a real answer
 * rather than a query parameter (P11 §12/§19). */
export interface ProviderPaymentState {
  reference: string;
  status: PaymentAttemptStatus;
  amountMinor: number;
  currency: string;
  failureCode: string | null;
  failureMessage: string | null;
  metadata: Record<string, unknown>;
}

/** A webhook body that verified. Producing one of these is the *only* way a
 * payment moves — the type exists so an unverified payload cannot be passed
 * where a verified one is expected. */
export interface VerifiedProviderEvent {
  /** The provider's event id. The database's uniqueness guarantee is built
   * on this, so an adapter whose provider does not supply one must derive a
   * stable value rather than invent a random one. */
  externalEventId: string;
  eventType: string;
  /** The provider's reference for the session this event concerns. */
  reference: string;
  status: PaymentAttemptStatus;
  /** The provider's own timestamp for the event, not our clock: ordering
   * two deliveries by arrival time would get it wrong exactly when it
   * matters. */
  occurredAt: Date;
  amountMinor: number | null;
  currency: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  metadata: Record<string, unknown>;
}

export type VerifyResult =
  | { ok: true; event: VerifiedProviderEvent }
  | { ok: false; reason: VerificationFailure; eventType?: string };

/** Why a delivery was refused. Recorded on the `WebhookEvent` row so a
 * misconfigured endpoint is diagnosable without turning on payload logging. */
export type VerificationFailure =
  | 'missing_signature'
  | 'bad_signature'
  | 'malformed_payload'
  | 'stale_timestamp'
  | 'unsupported_event';

export interface PaymentProviderAdapter {
  /** Matches a `PaymentProvider` enum value. */
  readonly name: 'HOSTED_CHECKOUT' | 'MANUAL' | 'PAYMOB' | 'TAP' | 'STRIPE';

  createSession(input: CreateSessionInput): Promise<ProviderSession>;

  /** Ask the provider what it actually thinks. The authority when a redirect
   * or an out-of-order event is not trustworthy enough to act on. */
  retrieveSession(reference: string): Promise<ProviderPaymentState | null>;

  /**
   * Verify a raw delivery. Takes the *raw body bytes* and the headers,
   * never a parsed object: a signature covers the exact bytes sent, and
   * re-serialising JSON before checking it is how signature verification
   * quietly stops working.
   */
  verifyWebhook(rawBody: string, headers: Headers): VerifyResult;
}
