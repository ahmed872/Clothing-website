/**
 * The one interface every email backend implements (P13 §1).
 *
 * The dispatcher and the template renderers talk to `EmailProviderAdapter`
 * and never to a vendor SDK — the same isolation `PaymentProviderAdapter`
 * (P11) and `StorageProvider` (P04) already give their domains. Adding a
 * real vendor means one file here and one `EMAIL_PROVIDER` value; nothing
 * about the outbox, the token domain, or the dispatcher's retry logic
 * changes.
 *
 * A message is already fully composed (subject/html/text) by the time it
 * reaches an adapter — no adapter ever sees a `userId`, a raw token, or
 * anything it would need to look up itself. That composition happens in
 * `templates.ts` and the public `send*Email` functions in `index.ts`.
 */

export interface EmailMessage {
  to: string;
  /** Display name for the `To` header, when known. Never influences
   * delivery logic — purely cosmetic ("Ahmed <ahmed@example.com>"). */
  toName: string | null;
  subject: string;
  html: string;
  /** Every message carries a plain-text alternative (P13 §11) — a client
   * that cannot or will not render HTML still gets a working link. */
  text: string;
}

export interface EmailSendResult {
  /** The provider's id for this send, when it gives one. Operational
   * correlation only — nothing in this application looks a delivery back up
   * by it. */
  providerMessageId: string | null;
}

/**
 * Whether a failure is worth retrying. The dispatcher (`email-dispatcher.ts`)
 * is the only reader of `kind`; nothing else branches on it.
 *
 *   transient  the provider (or the network) had a bad moment — a timeout, a
 *              connection reset, a 429, a 5xx. The same send will very likely
 *              succeed on a later attempt, so the outbox event goes back to
 *              `PENDING` with backoff.
 *   permanent  retrying cannot help — the provider rejected the message
 *              itself (an invalid address, a hard bounce, an authentication
 *              failure). The outbox event goes straight to `FAILED`.
 *
 * An adapter that is not sure which one applies should raise `transient`:
 * the retry budget is bounded (`MAX_ATTEMPTS` in `email-dispatcher.ts`), so
 * treating an ambiguous failure as retryable costs a few minutes of delay at
 * worst, while wrongly giving up permanently on a message that would have
 * gone through costs the customer a broken signup or a reset they cannot
 * complete.
 */
export type EmailSendFailureKind = 'transient' | 'permanent';

export class EmailSendError extends Error {
  readonly kind: EmailSendFailureKind;

  constructor(kind: EmailSendFailureKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EmailSendError';
    this.kind = kind;
  }
}

export function isEmailSendError(error: unknown): error is EmailSendError {
  return error instanceof EmailSendError;
}

export interface EmailProviderAdapter {
  /** Matches an `EMAIL_PROVIDER` value. */
  readonly name: 'console' | 'smtp' | 'test';

  /**
   * Send one message. Resolves with whatever correlation id the provider
   * gave (or `null`); rejects with an `EmailSendError` for any failure the
   * dispatcher should act on. Any *other* thrown error is treated by the
   * dispatcher exactly like a `transient` `EmailSendError` — see
   * `EmailSendFailureKind`'s own comment.
   */
  send(message: EmailMessage): Promise<EmailSendResult>;
}
