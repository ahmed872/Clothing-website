import { describe, expect, it } from 'vitest';

import { ALLOWED_PROVIDER_METADATA_KEYS, redactProviderPayload } from './redaction';

/**
 * The allowlist, tested by handing it exactly what a provider payload might
 * really carry — because the failure mode is silent: nobody notices a stored
 * auth token until it is in a backup.
 */

describe('redactProviderPayload', () => {
  it('keeps the reconciliation fields', () => {
    const kept = redactProviderPayload({
      id: 'sess_1',
      status: 'paid',
      amount: 36_000,
      currency: 'SAR',
      failure_code: null,
      card_last4: '4242',
      card_brand: 'mada',
    });
    expect(kept).toEqual({
      id: 'sess_1',
      status: 'paid',
      amount: 36_000,
      currency: 'SAR',
      failure_code: null,
      card_last4: '4242',
      card_brand: 'mada',
    });
  });

  it('drops everything it was not told to keep', () => {
    const kept = redactProviderPayload({
      id: 'sess_1',
      // The fields that must never reach disk.
      card_number: '4242424242424242',
      cvv: '123',
      cardholder_name: 'A Customer',
      auth_token: 'tok_live_secret',
      api_key: 'sk_live_secret',
      customer_ip: '10.0.0.1',
      billing_address: '…',
    });
    expect(kept).toEqual({ id: 'sess_1' });
    expect(JSON.stringify(kept)).not.toContain('4242424242424242');
    expect(JSON.stringify(kept)).not.toContain('sk_live');
  });

  it('drops nested objects entirely, which is where a surprise secret hides', () => {
    const kept = redactProviderPayload({
      id: 'sess_1',
      // Even under an allowlisted key: an object is never kept.
      status: { value: 'paid', raw_card: '4242424242424242' },
      source: { token: 'tok_secret' },
    });
    expect(kept).toEqual({ id: 'sess_1' });
  });

  it('truncates a long value rather than storing a log line', () => {
    const kept = redactProviderPayload({ failure_message: 'x'.repeat(1000) });
    expect(String(kept.failure_message)).toHaveLength(257);
  });

  it('returns an empty object for anything that is not an object', () => {
    for (const input of [null, undefined, 'string', 42, [1, 2, 3]]) {
      expect(redactProviderPayload(input)).toEqual({});
    }
  });

  it('names no key that looks like a credential', () => {
    for (const key of ALLOWED_PROVIDER_METADATA_KEYS) {
      expect(key).not.toMatch(/secret|token|key|password|cvv|pan/i);
    }
  });
});
