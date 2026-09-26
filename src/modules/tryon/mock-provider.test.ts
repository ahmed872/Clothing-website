import { describe, expect, it } from 'vitest';

import { buildSignatureHeader } from '@/modules/payments';

import {
  MOCK_PROCESSING_MS,
  TRYON_SIGNATURE_HEADER,
  createMockTryOnProvider,
} from './mock-provider';
import type { TryOnProviderRequest } from './provider';

/**
 * The mock provider: labelled, deterministic, image-free — and its callback
 * verification is the real HMAC check, not a stand-in.
 */

const SECRET = 'b'.repeat(64);
const T0 = new Date('2026-09-26T12:00:00.000Z');

function request(jobId = '6f1c2d3e-0000-4000-8000-000000000001'): TryOnProviderRequest {
  return {
    jobId,
    garment: {
      productId: 'p',
      variantId: 'v',
      garmentType: 'T_SHIRT',
      name: { ar: 'تيشيرت', en: 'Tee' },
      sizeLabel: { ar: 'M', en: 'M' },
      colorHex: null,
      imageUrl: null,
    },
    body: {
      gender: 'MALE',
      heightCm: 177,
      weightKg: 78,
      waistCm: 84,
      chestCm: null,
      hipCm: null,
      shoulderCm: null,
      inseamCm: null,
    },
  };
}

function signed(body: unknown, at: Date, secret = SECRET) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    raw,
    headers: new Headers({ [TRYON_SIGNATURE_HEADER]: buildSignatureHeader(secret, raw, at) }),
  };
}

const CALLBACK = {
  eventId: 'evt-1',
  providerJobId: 'mock_abc_0123456789abcdef',
  status: 'completed',
  resultUrl: null,
  errorCode: null,
  occurredAt: T0.toISOString(),
};

describe('the mock try-on provider', () => {
  it('says what it is: a mock that needs no photo', () => {
    const provider = createMockTryOnProvider({ callbackSecret: SECRET });
    expect(provider).toMatchObject({ name: 'mock', isMock: true, requiresCustomerPhoto: false });
  });

  it('processes for a fixed time, then completes with no image', async () => {
    let now = T0;
    const provider = createMockTryOnProvider({ callbackSecret: SECRET, clock: () => now });
    const created = await provider.createJob(request());
    expect(created).toMatchObject({ status: 'processing', resultUrl: null, errorCode: null });

    now = new Date(T0.getTime() + MOCK_PROCESSING_MS - 1);
    expect(await provider.getJob(created.providerJobId)).toMatchObject({ status: 'processing' });
    now = new Date(T0.getTime() + MOCK_PROCESSING_MS);
    expect(await provider.getJob(created.providerJobId)).toEqual({
      providerJobId: created.providerJobId,
      status: 'completed',
      resultUrl: null,
      errorCode: null,
    });
  });

  it('is deterministic, and knows only its own job ids', async () => {
    const clock = () => T0;
    const a = createMockTryOnProvider({ callbackSecret: SECRET, clock });
    const b = createMockTryOnProvider({ callbackSecret: SECRET, clock });
    expect((await a.createJob(request())).providerJobId).toBe(
      (await b.createJob(request())).providerJobId,
    );
    expect(await a.getJob('someone-elses-id')).toBeNull();
  });

  describe('callback verification', () => {
    const provider = createMockTryOnProvider({ callbackSecret: SECRET, clock: () => T0 });

    it('accepts a correctly signed, well-formed callback', () => {
      const { raw, headers } = signed(CALLBACK, T0);
      expect(provider.verifyCallback(raw, headers)).toMatchObject({
        ok: true,
        callback: { eventId: 'evt-1', state: { status: 'completed', resultUrl: null } },
      });
    });

    it('refuses a missing, wrong or re-signed-with-another-key signature', () => {
      const { raw } = signed(CALLBACK, T0);
      expect(provider.verifyCallback(raw, new Headers())).toEqual({
        ok: false,
        reason: 'missing_signature',
      });
      const forged = signed(CALLBACK, T0, 'c'.repeat(64));
      expect(provider.verifyCallback(raw, forged.headers)).toEqual({
        ok: false,
        reason: 'bad_signature',
      });
    });

    it('refuses a body changed after signing', () => {
      const { headers } = signed(CALLBACK, T0);
      const tampered = JSON.stringify({ ...CALLBACK, status: 'failed' });
      expect(provider.verifyCallback(tampered, headers)).toEqual({
        ok: false,
        reason: 'bad_signature',
      });
    });

    it('refuses a replay outside the time window, however well signed', () => {
      const { raw, headers } = signed(CALLBACK, new Date(T0.getTime() - 10 * 60 * 1000));
      expect(provider.verifyCallback(raw, headers)).toEqual({
        ok: false,
        reason: 'stale_timestamp',
      });
    });

    it.each([
      ['not JSON', 'not json'],
      ['an unknown status', { ...CALLBACK, status: 'done' }],
      ['an extra field', { ...CALLBACK, customerId: 'x' }],
      ['a missing field', { ...CALLBACK, eventId: undefined }],
      ['an oversized URL', { ...CALLBACK, resultUrl: `https://a.test/${'x'.repeat(2100)}` }],
      [
        'free text as an error code',
        { ...CALLBACK, status: 'failed', errorCode: 'Some <b>message</b>' },
      ],
    ])('refuses a signed body with %s', (_label, body) => {
      const { raw, headers } = signed(body, T0);
      expect(provider.verifyCallback(raw, headers)).toEqual({
        ok: false,
        reason: 'malformed_payload',
      });
    });
  });
});
