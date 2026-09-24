import type { EmailMessage, EmailProviderAdapter, EmailSendResult } from './provider';

/**
 * `EMAIL_PROVIDER="console"` — the default (P13 §2).
 *
 * The honest "not configured yet" adapter, the same stance
 * `PAYMENT_PROVIDER="none"` already takes: a fresh checkout of this
 * repository boots and the outbox genuinely drains (every event is claimed,
 * "delivered", and marked `SENT`), but nobody's inbox is ever reached. What
 * is logged is a single sanitized line — recipient, subject, provider name —
 * never the HTML/text body, because the body is exactly where the
 * verification/reset link lives, and this function has no way to know its
 * output will not end up in a shared log aggregator (P13 §12/§13).
 *
 * This is not a mock and not a vendor stand-in: it really does discharge the
 * application's side of "hand this to the configured provider." Whether
 * that provider actually reaches an inbox is precisely what `EMAIL_PROVIDER`
 * being `console` says it does not, yet.
 */
export const consoleEmailProvider: EmailProviderAdapter = {
  name: 'console',

  async send(message: EmailMessage): Promise<EmailSendResult> {
    console.log(
      `[email:console] to=${message.to} subject=${JSON.stringify(message.subject)} — ` +
        `EMAIL_PROVIDER=console, no real delivery attempted`,
    );
    return { providerMessageId: null };
  },
};
