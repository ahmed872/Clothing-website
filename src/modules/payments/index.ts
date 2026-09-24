/**
 * `payments` — payment attempts, provider adapters, webhook verification and
 * idempotency.
 *
 * May depend on: core
 * Must not depend on: orders — payments are called by orders through an
 * interface, never the reverse. That direction is what stops a payment from
 * ever deciding what something costs: every amount reaching this module was
 * read from a stored order by the caller.
 *
 * Other modules import `@/modules/payments`, never a file inside it — with
 * the one documented exception of `payment-status`, which is pure and is
 * imported directly by client components (the barrel re-exports server-only
 * code, so pulling it into the browser fails the build, by design).
 */

export {
  LIVE_ATTEMPT_STATUSES,
  PAYMENT_ATTEMPT_TRANSITIONS,
  TERMINAL_ATTEMPT_STATUSES,
  canTransitionAttempt,
  isLiveAttempt,
  isNewerEvent,
  isTerminalAttempt,
  orderPaymentStatusFor,
} from './payment-status';

export type {
  CreateSessionInput,
  PaymentProviderAdapter,
  ProviderPaymentState,
  ProviderSession,
  VerificationFailure,
  VerifiedProviderEvent,
  VerifyResult,
} from './provider';

export {
  getPaymentProvider,
  isPaymentEnabled,
  requirePaymentProvider,
  resetPaymentProviderCache,
} from './provider-factory';

export {
  SIGNATURE_TOLERANCE_SECONDS,
  buildSignatureHeader,
  computeSignature,
  parseSignatureHeader,
  signaturesMatch,
  verifySignedPayload,
} from './signature';

export { ALLOWED_PROVIDER_METADATA_KEYS, redactProviderPayload } from './redaction';

export {
  applyEventWithin,
  closeAttemptWithin,
  findAttemptByReferenceWithin,
  findLiveAttempt,
  getAttemptById,
  listAttemptsForOrder,
  markWebhookProcessedWithin,
  recordWebhookDeliveryWithin,
  startAttempt,
} from './payment.service';

export type {
  ApplyEventOutcome,
  StartAttemptInput,
  StartAttemptResult,
  WebhookRecordOutcome,
} from './payment.service';
