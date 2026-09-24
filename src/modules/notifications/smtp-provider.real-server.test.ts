import { createServer } from 'node:net';

import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `smtp-server` real-integration coverage (P14 §4).
 *
 * `smtp-provider.test.ts` mocks `nodemailer` entirely, which proves this
 * adapter's own branching logic but nothing about whether it actually
 * speaks SMTP correctly on the wire. This file replaces that mock with a
 * real SMTP server — `smtp-server` is the exact companion library
 * `nodemailer` itself ships (same author, same GitHub org), a standards-
 * compliant RFC 5321 server, not a vendor SDK or a fabricated stand-in.
 * Running it on `127.0.0.1` and pointing `smtpEmailProvider` at it is
 * precisely the "self-hosted relay" configuration `smtp-provider.ts`'s own
 * comment already names as this adapter's real target — it is not a vendor
 * integration test and does not claim to be one.
 *
 * No live vendor SMTP credentials exist anywhere in this environment (P14's
 * own audit confirmed this by direct inspection — no `EMAIL_SMTP_*` value
 * has ever been set in `.env`/`.env.test`/CI, and no such credential is
 * reachable from this sandbox). This file is the honest ceiling of what can
 * be verified without one: a real SMTP conversation, a real accepted
 * message decoded by a real MIME parser (`mailparser`, same author again),
 * and real SMTP rejection codes fed back through this adapter's own
 * `classify()` — not a mocked error shape standing in for what a real
 * server's rejection looks like. Live delivery through an actual mail
 * relay to a real internet mailbox stays ENVIRONMENT-BLOCKED; see the P14
 * report.
 */

let server: SMTPServer;
let port: number;

type RcptBehavior = { code: number; message: string } | null;
let rcptBehavior: RcptBehavior = null;

interface ReceivedMail {
  envelopeFrom: string;
  envelopeTo: string[];
  raw: Buffer;
}
let received: ReceivedMail[] = [];

/** An OS-assigned free port, found by opening and immediately closing a
 * throwaway listener — avoids hardcoding a port the sandbox might already
 * have bound. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('could not determine a free port'));
      });
    });
    probe.on('error', reject);
  });
}

beforeEach(async () => {
  received = [];
  rcptBehavior = null;
  port = await freePort();

  server = new SMTPServer({
    // No TLS configured — this test server represents a plain, unencrypted
    // relay on a trusted local network (localhost), not a claim that
    // production should skip TLS. `smtp-provider.ts` only requests implicit
    // TLS on port 465; disabling STARTTLS here just keeps this test server
    // from advertising a capability nothing here would use.
    disabledCommands: ['STARTTLS', 'AUTH'],
    onRcptTo(_address, _session, callback) {
      if (rcptBehavior) {
        const error = new Error(rcptBehavior.message) as Error & { responseCode: number };
        error.responseCode = rcptBehavior.code;
        callback(error);
        return;
      }
      callback();
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        received.push({
          envelopeFrom: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          envelopeTo: session.envelope.rcptTo.map((r) => r.address),
          raw: Buffer.concat(chunks),
        });
        callback();
      });
    },
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const serverEnvMock = vi.fn();
vi.mock('@/modules/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/core')>();
  return { ...actual, serverEnv: serverEnvMock };
});

const { smtpEmailProvider, resetSmtpTransportCache } = await import('./smtp-provider');
const { isEmailSendError } = await import('./provider');
const { buildVerificationEmail } = await import('./templates');

function mockEnv() {
  serverEnvMock.mockReturnValue({
    EMAIL_FROM: 'no-reply@luxedrive.example',
    EMAIL_FROM_NAME: 'LuxeDrive',
    EMAIL_SMTP_HOST: '127.0.0.1',
    EMAIL_SMTP_PORT: port,
    EMAIL_SMTP_USER: undefined,
    EMAIL_SMTP_PASSWORD: undefined,
  });
  resetSmtpTransportCache();
}

describe('smtpEmailProvider — real local SMTP server (P14 §4)', () => {
  it('completes a real SMTP conversation and the server receives the exact English verification email', async () => {
    mockEnv();
    const message = buildVerificationEmail({
      to: 'shopper@example.com',
      toName: 'Shopper One',
      ctaUrl: 'https://luxedrive.example/en/account/verify-email?token=abc123XYZ-_token',
      copy: {
        htmlLang: 'en',
        dir: 'ltr',
        subject: 'Verify your email — LuxeDrive',
        heading: 'Verify your email address',
        greeting: 'Hi Shopper One,',
        body: 'Thanks for creating a LuxeDrive account. To finish setting it up, please confirm this is your email address.',
        ctaLabel: 'Verify email',
        expiryNotice: 'This link expires in 24 hours.',
        ignoreNotice: "If you didn't request this, you can ignore this email.",
        fallbackNotice: "If the button doesn't work, copy and paste this link into your browser:",
        footer: '© 2026 LuxeDrive. All rights reserved.',
        automatedNotice: 'This is an automated message — replies are not monitored.',
      },
    });

    const result = await smtpEmailProvider.send(message);
    expect(result.providerMessageId).not.toBeNull();

    expect(received).toHaveLength(1);
    const mail = received[0]!;
    expect(mail.envelopeFrom).toBe('no-reply@luxedrive.example');
    expect(mail.envelopeTo).toEqual(['shopper@example.com']);

    const parsed = await simpleParser(mail.raw);
    expect(parsed.subject).toBe('Verify your email — LuxeDrive');
    expect(parsed.from?.text).toContain('no-reply@luxedrive.example');
    expect(parsed.to && 'text' in parsed.to ? parsed.to.text : '').toContain('shopper@example.com');
    expect(parsed.text).toContain(
      'https://luxedrive.example/en/account/verify-email?token=abc123XYZ-_token',
    );
    expect(parsed.html).toContain(
      'https://luxedrive.example/en/account/verify-email?token=abc123XYZ-_token',
    );
    // The raw token must reach the real wire format intact — MIME transport
    // encoding (quoted-printable/base64) is exactly the kind of thing that
    // can silently corrupt a token if this adapter ever mishandled it.
    expect(parsed.text).toContain('abc123XYZ-_token');
  });

  it('completes a real SMTP conversation and the server receives the exact Arabic verification email, correctly MIME-encoded', async () => {
    mockEnv();
    const message = buildVerificationEmail({
      to: 'مستخدم@example.com'.normalize(),
      toName: 'أحمد',
      ctaUrl: 'https://luxedrive.example/ar/account/verify-email?token=abc123',
      copy: {
        htmlLang: 'ar',
        dir: 'rtl',
        subject: 'تأكيد بريدك الإلكتروني — LuxeDrive',
        heading: 'تأكيد بريدك الإلكتروني',
        greeting: 'مرحبًا أحمد،',
        body: 'شكرًا لإنشاء حساب في LuxeDrive. لإتمام إعداد حسابك، يرجى تأكيد أن هذا هو بريدك الإلكتروني.',
        ctaLabel: 'تأكيد البريد الإلكتروني',
        expiryNotice: 'تنتهي صلاحية هذا الرابط خلال 24 ساعة.',
        ignoreNotice: 'إذا لم تطلب هذا، يمكنك تجاهل هذه الرسالة.',
        fallbackNotice: 'إذا لم يعمل الزر، انسخ الرابط التالي والصقه في متصفحك:',
        footer: '© 2026 LuxeDrive. جميع الحقوق محفوظة.',
        automatedNotice: 'هذه رسالة آلية — لا تتم مراقبة الردود عليها.',
      },
    });

    // Real, non-ASCII recipient handling is a separate, harder concern
    // (SMTPUTF8) this adapter does not claim to support — this test targets
    // an ASCII mailbox with Arabic *content*, the actually-supported case.
    const asciiRecipientMessage = { ...message, to: 'shopper-ar@example.com' };
    const result = await smtpEmailProvider.send(asciiRecipientMessage);
    expect(result.providerMessageId).not.toBeNull();

    expect(received).toHaveLength(1);
    const mail = received[0]!;
    expect(mail.envelopeTo).toEqual(['shopper-ar@example.com']);

    // The raw header line must be RFC 2047 encoded, not raw UTF-8 bytes
    // dropped into a header — a real, historically common way to break
    // non-Latin subjects.
    const headerSection = mail.raw.toString('latin1').split(/\r?\n\r?\n/)[0]!;
    const subjectLine = headerSection.split(/\r?\n(?!\s)/).find((line) => /^subject:/i.test(line));
    expect(subjectLine).toBeDefined();
    expect(subjectLine).toMatch(/=\?UTF-8\?[BQ]\?/i);

    const parsed = await simpleParser(mail.raw);
    expect(parsed.subject).toBe('تأكيد بريدك الإلكتروني — LuxeDrive');
    expect(parsed.text).toContain('شكرًا لإنشاء حساب في LuxeDrive');
    expect(parsed.text).toContain('https://luxedrive.example/ar/account/verify-email?token=abc123');
  });

  it('classifies a real 550 SMTP rejection from a real server as permanent', async () => {
    mockEnv();
    rcptBehavior = { code: 550, message: 'Mailbox does not exist' };

    const message = buildVerificationEmail({
      to: 'nobody@example.com',
      toName: null,
      ctaUrl: 'https://luxedrive.example/en/account/verify-email?token=x',
      copy: minimalCopy(),
    });

    await expect(smtpEmailProvider.send(message)).rejects.toSatisfy((error: unknown) => {
      expect(isEmailSendError(error) && error.kind).toBe('permanent');
      // The real server's own rejection text must never leak into the
      // error this adapter raises — the dispatcher persists that message
      // verbatim as `OutboxEvent.lastError` (P13 §12/§13).
      expect((error as Error).message).not.toContain('Mailbox does not exist');
      return true;
    });
  });

  it('classifies a real 450 SMTP rejection from a real server as transient', async () => {
    mockEnv();
    rcptBehavior = { code: 450, message: 'Mailbox temporarily unavailable' };

    const message = buildVerificationEmail({
      to: 'busy@example.com',
      toName: null,
      ctaUrl: 'https://luxedrive.example/en/account/verify-email?token=x',
      copy: minimalCopy(),
    });

    await expect(smtpEmailProvider.send(message)).rejects.toSatisfy((error: unknown) => {
      expect(isEmailSendError(error) && error.kind).toBe('transient');
      return true;
    });
  });
});

function minimalCopy() {
  return {
    htmlLang: 'en' as const,
    dir: 'ltr' as const,
    subject: 'Verify your email — LuxeDrive',
    heading: 'Verify your email address',
    greeting: 'Hi,',
    body: 'body',
    ctaLabel: 'Verify email',
    expiryNotice: 'expires',
    ignoreNotice: 'ignore',
    fallbackNotice: 'fallback',
    footer: 'footer',
    automatedNotice: 'automated',
  };
}
