import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consoleEmailProvider } from './console-provider';

describe('consoleEmailProvider', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('resolves without a provider message id — no real send happened', async () => {
    const result = await consoleEmailProvider.send({
      to: 'shopper@example.com',
      toName: 'Shopper',
      subject: 'Verify your email',
      html: '<a href="https://luxedrive.example/verify?token=super-secret-token">Verify</a>',
      text: 'https://luxedrive.example/verify?token=super-secret-token',
    });
    expect(result.providerMessageId).toBeNull();
  });

  it('logs the recipient and subject, but never the html/text body — the token/link must never reach a log', async () => {
    await consoleEmailProvider.send({
      to: 'shopper@example.com',
      toName: 'Shopper',
      subject: 'Reset your password',
      html: '<a href="https://luxedrive.example/reset?token=super-secret-token">Reset</a>',
      text: 'https://luxedrive.example/reset?token=super-secret-token',
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [line] = logSpy.mock.calls[0]!;
    expect(String(line)).toContain('shopper@example.com');
    expect(String(line)).toContain('Reset your password');
    expect(String(line)).not.toContain('super-secret-token');
    expect(String(line)).not.toContain('href=');
  });
});
