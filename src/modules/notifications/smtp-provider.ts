import 'server-only';

import { createTransport, type Transporter } from 'nodemailer';

import { serverEnv } from '@/modules/core';

import {
  EmailSendError,
  type EmailMessage,
  type EmailProviderAdapter,
  type EmailSendResult,
} from './provider';

/**
 * `EMAIL_PROVIDER="smtp"` — the real provider (P13 §2).
 *
 * Built on SMTP (RFC 5321) rather than one vendor's HTTP API on purpose:
 * every transactional email service (Postmark, SES, Mailgun, Resend, …)
 * also exposes an SMTP endpoint, a self-hosted mail relay speaks nothing
 * else, and — the reason this matters here — SMTP's request/response
 * contract is a public standard this file can implement correctly and
 * completely, rather than a vendor's private JSON schema guessed at from
 * memory (P13 §20 is explicit that the latter must never happen). Swapping
 * to a vendor's own HTTP API later is a second adapter beside this one, not
 * a change to `EMAIL_PROVIDER="smtp"`'s contract.
 *
 * `nodemailer` is the transport client (the SMTP-protocol equivalent of
 * `pg` for Postgres), not a vendor SDK — no dependency in this repository
 * before P13 speaks SMTP at all, which is why it is a new one.
 *
 * Environment-blocked in every environment this project has touched so
 * far: no `EMAIL_SMTP_*` value has ever been set anywhere in this
 * repository's `.env`/`.env.test`/CI configuration, so this file has never
 * been exercised against a real mail server and that fact is stated
 * plainly in the P13 report rather than implied away.
 */

let cachedTransport: Transporter | undefined;

function transport(): Transporter {
  if (cachedTransport) return cachedTransport;

  const env = serverEnv();
  if (!env.EMAIL_SMTP_HOST || !env.EMAIL_SMTP_PORT) {
    // Unreachable in practice: `provider-factory.ts` only constructs this
    // adapter when `EMAIL_PROVIDER=smtp`, and the env schema's `superRefine`
    // already requires both fields whenever that is set. Guarded anyway
    // because a transport client silently pointed at `undefined:undefined`
    // is a worse failure mode than a clear thrown error.
    throw new EmailSendError(
      'permanent',
      'smtp provider: EMAIL_SMTP_HOST/EMAIL_SMTP_PORT not configured',
    );
  }

  cachedTransport = createTransport({
    host: env.EMAIL_SMTP_HOST,
    port: env.EMAIL_SMTP_PORT,
    // Implicit TLS on 465; STARTTLS (upgraded after connecting) on every
    // other port, 587 included — the conventional split every mail server
    // and every provider's setup instructions use.
    secure: env.EMAIL_SMTP_PORT === 465,
    auth:
      env.EMAIL_SMTP_USER && env.EMAIL_SMTP_PASSWORD
        ? { user: env.EMAIL_SMTP_USER, pass: env.EMAIL_SMTP_PASSWORD }
        : undefined,
  });
  return cachedTransport;
}

/** SMTP reply codes are three digits; the first digit is the whole
 * category. 4xx is "temporary, try again later" and 5xx is "permanent,
 * do not retry as-is" — RFC 5321 §4.2.1, not a guess. A code nodemailer
 * did not surface (a raw network/timeout error, `err.responseCode`
 * undefined) is treated as transient — see `EmailSendFailureKind`'s own
 * "ambiguous defaults to transient" reasoning. */
function classify(error: unknown): EmailSendError {
  const responseCode =
    typeof error === 'object' && error !== null && 'responseCode' in error
      ? Number((error as { responseCode?: unknown }).responseCode)
      : undefined;

  if (responseCode && responseCode >= 500 && responseCode < 600) {
    return new EmailSendError('permanent', 'smtp provider: permanent rejection', { cause: error });
  }
  return new EmailSendError('transient', 'smtp provider: send failed', { cause: error });
}

export const smtpEmailProvider: EmailProviderAdapter = {
  name: 'smtp',

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const env = serverEnv();
    const fromName = env.EMAIL_FROM_NAME ?? 'LuxeDrive';

    try {
      const info = await transport().sendMail({
        from: `${fromName} <${env.EMAIL_FROM}>`,
        to: message.toName ? `${message.toName} <${message.to}>` : message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      return { providerMessageId: info.messageId ?? null };
    } catch (error) {
      throw classify(error);
    }
  },
};

/** Test-only: forces a fresh transport on the next send. */
export function resetSmtpTransportCache(): void {
  cachedTransport = undefined;
}
