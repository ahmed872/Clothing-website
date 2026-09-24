import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The `smtp` adapter's own logic (P13 §2) — everything that does not
 * require a real mail server: building the transport from `EMAIL_SMTP_*`,
 * classifying a failure as transient/permanent by SMTP reply code (RFC 5321
 * §4.2.1), and — the property that matters most here — never letting the
 * provider's own raw response text leak into the thrown error's `message`,
 * which is exactly what the dispatcher persists as `OutboxEvent.lastError`
 * (P13 §12/§13's "never log provider-supplied text" boundary).
 *
 * `nodemailer` is mocked; this file proves this adapter's own code, not
 * `nodemailer` itself.
 */

const sendMailMock = vi.fn();
const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));
vi.mock('nodemailer', () => ({ createTransport: createTransportMock }));

const serverEnvMock = vi.fn();
vi.mock('@/modules/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/core')>();
  return { ...actual, serverEnv: serverEnvMock };
});

const { smtpEmailProvider, resetSmtpTransportCache } = await import('./smtp-provider');
const { isEmailSendError } = await import('./provider');

function mockEnv(overrides: Record<string, unknown> = {}) {
  serverEnvMock.mockReturnValue({
    EMAIL_FROM: 'no-reply@example.com',
    EMAIL_FROM_NAME: undefined,
    EMAIL_SMTP_HOST: 'smtp.example.com',
    EMAIL_SMTP_PORT: 587,
    EMAIL_SMTP_USER: undefined,
    EMAIL_SMTP_PASSWORD: undefined,
    ...overrides,
  });
}

const MESSAGE = {
  to: 'shopper@example.com',
  toName: 'Shopper',
  subject: 'Verify your email',
  html: '<a href="https://luxedrive.example/verify?token=super-secret-token">Verify</a>',
  text: 'https://luxedrive.example/verify?token=super-secret-token',
};

beforeEach(() => {
  sendMailMock.mockReset();
  createTransportMock.mockClear();
  resetSmtpTransportCache();
  mockEnv();
});

describe('smtpEmailProvider.send', () => {
  it('builds the transport from EMAIL_SMTP_* and sends via nodemailer', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'msg-1' });
    const result = await smtpEmailProvider.send(MESSAGE);

    expect(result.providerMessageId).toBe('msg-1');
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.example.com', port: 587, secure: false }),
    );
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'LuxeDrive <no-reply@example.com>',
        to: 'Shopper <shopper@example.com>',
        subject: MESSAGE.subject,
      }),
    );
  });

  it('uses implicit TLS only on port 465', async () => {
    mockEnv({ EMAIL_SMTP_PORT: 465 });
    sendMailMock.mockResolvedValue({ messageId: 'm' });
    await smtpEmailProvider.send(MESSAGE);
    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({ secure: true }));
  });

  it('caches the transport across sends until reset', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'm' });
    await smtpEmailProvider.send(MESSAGE);
    await smtpEmailProvider.send(MESSAGE);
    expect(createTransportMock).toHaveBeenCalledTimes(1);
  });

  it('classifies a 5xx SMTP reply as permanent', async () => {
    sendMailMock.mockRejectedValue({ responseCode: 550, message: 'raw smtp bounce text' });
    try {
      await smtpEmailProvider.send(MESSAGE);
      expect.unreachable();
    } catch (error) {
      expect(isEmailSendError(error) && error.kind).toBe('permanent');
    }
  });

  it('classifies a 4xx SMTP reply, and any unclassified error, as transient', async () => {
    sendMailMock.mockRejectedValue({ responseCode: 421, message: 'try again later' });
    try {
      await smtpEmailProvider.send(MESSAGE);
      expect.unreachable();
    } catch (error) {
      expect(isEmailSendError(error) && error.kind).toBe('transient');
    }

    sendMailMock.mockRejectedValue(new Error('ECONNRESET'));
    try {
      await smtpEmailProvider.send(MESSAGE);
      expect.unreachable();
    } catch (error) {
      expect(isEmailSendError(error) && error.kind).toBe('transient');
    }
  });

  it('never lets the provider’s raw response text reach the thrown error’s own message', async () => {
    sendMailMock.mockRejectedValue({
      responseCode: 550,
      message: 'raw smtp bounce text mentioning shopper@example.com',
      response: '550 5.1.1 mailbox unavailable — full provider text',
    });
    try {
      await smtpEmailProvider.send(MESSAGE);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).not.toContain('raw smtp bounce text');
      expect(message).not.toContain('full provider text');
      expect(message).not.toContain('shopper@example.com');
    }
  });
});
