import { beforeEach, describe, expect, it } from 'vitest';

import { isEmailSendError } from './provider';
import { clearTestInbox, readTestInbox, testEmailProvider } from './test-provider';

describe('testEmailProvider', () => {
  beforeEach(async () => {
    await clearTestInbox();
  });

  it('writes a real message to the inbox and returns a provider message id', async () => {
    const result = await testEmailProvider.send({
      to: 'shopper-inbox@example.com',
      toName: 'Shopper',
      subject: 'Verify your email',
      html: '<a href="https://luxedrive.example/verify?token=abc">Verify</a>',
      text: 'https://luxedrive.example/verify?token=abc',
    });
    expect(result.providerMessageId).toMatch(/^test_/);

    const inbox = await readTestInbox('shopper-inbox@example.com');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.subject).toBe('Verify your email');
    expect(inbox[0]!.html).toContain('token=abc');
  });

  it('keeps multiple messages to the same address, oldest first', async () => {
    await testEmailProvider.send({
      to: 'shopper-multi@example.com',
      toName: null,
      subject: 'First',
      html: '<p>first</p>',
      text: 'first',
    });
    await testEmailProvider.send({
      to: 'shopper-multi@example.com',
      toName: null,
      subject: 'Second',
      html: '<p>second</p>',
      text: 'second',
    });

    const inbox = await readTestInbox('shopper-multi@example.com');
    expect(inbox.map((m) => m.subject)).toEqual(['First', 'Second']);
  });

  it('returns nothing for an address that never received anything', async () => {
    expect(await readTestInbox('nobody-ever@example.com')).toEqual([]);
  });

  it('simulates a transient failure for the +dispatch-fail-transient tag, and writes nothing', async () => {
    const to = 'shopper+dispatch-fail-transient@example.com';
    await expect(
      testEmailProvider.send({ to, toName: null, subject: 's', html: 'h', text: 't' }),
    ).rejects.toSatisfy((error: unknown) => isEmailSendError(error) && error.kind === 'transient');
    expect(await readTestInbox(to)).toEqual([]);
  });

  it('simulates a permanent failure for the +dispatch-fail-permanent tag, and writes nothing', async () => {
    const to = 'shopper+dispatch-fail-permanent@example.com';
    await expect(
      testEmailProvider.send({ to, toName: null, subject: 's', html: 'h', text: 't' }),
    ).rejects.toSatisfy((error: unknown) => isEmailSendError(error) && error.kind === 'permanent');
    expect(await readTestInbox(to)).toEqual([]);
  });
});
