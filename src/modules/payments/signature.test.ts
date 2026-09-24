import { describe, expect, it } from 'vitest';

import {
  SIGNATURE_TOLERANCE_SECONDS,
  buildSignatureHeader,
  computeSignature,
  parseSignatureHeader,
  signaturesMatch,
  verifySignedPayload,
} from './signature';

/**
 * Signature verification, asserted from the attacker's side: each test tries
 * the thing that must not work.
 *
 * Deterministic fixtures throughout — a fixed secret, a fixed body, a fixed
 * clock — so these run identically with or without provider credentials.
 * This is the part of the integration that does not need a vendor to be
 * proven correct.
 */

const SECRET = 'a'.repeat(64);
const BODY = '{"event_id":"evt_1","id":"sess_1","status":"paid","amount":36000}';
const NOW = new Date('2026-09-02T12:00:00Z');

describe('header parsing', () => {
  it('reads the timestamp and signature', () => {
    expect(parseSignatureHeader('t=1756814400,v1=abcd')).toEqual({
      timestamp: 1756814400,
      signature: 'abcd',
    });
  });

  it('returns null for anything malformed rather than throwing', () => {
    for (const header of [null, '', 'garbage', 't=notanumber,v1=ab', 'v1=ab', 't=1756814400']) {
      expect(parseSignatureHeader(header)).toBeNull();
    }
  });
});

describe('constant-time comparison', () => {
  it('accepts an identical signature', () => {
    const sig = computeSignature(SECRET, 1756814400, BODY);
    expect(signaturesMatch(sig, sig)).toBe(true);
  });

  it('refuses a signature of a different length without throwing', () => {
    expect(signaturesMatch('aabb', 'aa')).toBe(false);
  });

  it('refuses non-hex input without throwing', () => {
    expect(signaturesMatch('zzzz', 'zzzz')).toBe(false);
  });

  it('refuses a one-character difference', () => {
    const sig = computeSignature(SECRET, 1756814400, BODY);
    const tampered = `${sig.slice(0, -1)}${sig.endsWith('a') ? 'b' : 'a'}`;
    expect(signaturesMatch(sig, tampered)).toBe(false);
  });
});

describe('verifySignedPayload', () => {
  function header(now = NOW, secret = SECRET, body = BODY) {
    return buildSignatureHeader(secret, body, now);
  }

  it('accepts a delivery signed with the configured secret', () => {
    expect(
      verifySignedPayload({ secret: SECRET, rawBody: BODY, header: header(), now: NOW }),
    ).toEqual({ ok: true });
  });

  it('refuses a delivery with no signature at all', () => {
    expect(verifySignedPayload({ secret: SECRET, rawBody: BODY, header: null, now: NOW })).toEqual({
      ok: false,
      reason: 'missing_signature',
    });
  });

  it('refuses a delivery signed with the wrong secret', () => {
    const wrong = header(NOW, 'b'.repeat(64));
    expect(verifySignedPayload({ secret: SECRET, rawBody: BODY, header: wrong, now: NOW })).toEqual(
      { ok: false, reason: 'bad_signature' },
    );
  });

  it('refuses a body that changed after it was signed', () => {
    // The whole point: an attacker who intercepts a real delivery and edits
    // the amount cannot re-sign it.
    const valid = header();
    const tampered = BODY.replace('36000', '1');
    expect(
      verifySignedPayload({ secret: SECRET, rawBody: tampered, header: valid, now: NOW }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a body whose keys were merely reordered', () => {
    // Documents why the raw bytes are verified and not a re-serialised
    // object: semantically identical JSON does not carry the same signature.
    const reordered = '{"id":"sess_1","event_id":"evt_1","status":"paid","amount":36000}';
    expect(
      verifySignedPayload({ secret: SECRET, rawBody: reordered, header: header(), now: NOW }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a captured delivery replayed later, signature and all', () => {
    const captured = header(NOW);
    const muchLater = new Date(NOW.getTime() + (SIGNATURE_TOLERANCE_SECONDS + 60) * 1000);
    expect(
      verifySignedPayload({ secret: SECRET, rawBody: BODY, header: captured, now: muchLater }),
    ).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('refuses a delivery timestamped in the future beyond tolerance', () => {
    const future = new Date(NOW.getTime() + (SIGNATURE_TOLERANCE_SECONDS + 60) * 1000);
    expect(
      verifySignedPayload({ secret: SECRET, rawBody: BODY, header: header(future), now: NOW }),
    ).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('still accepts a slow but honest retry inside the window', () => {
    const slightlyLate = new Date(NOW.getTime() + (SIGNATURE_TOLERANCE_SECONDS - 30) * 1000);
    expect(
      verifySignedPayload({
        secret: SECRET,
        rawBody: BODY,
        header: header(NOW),
        now: slightlyLate,
      }),
    ).toEqual({ ok: true });
  });

  it('checks staleness before the HMAC, so a stale delivery is named as stale', () => {
    // A wrong-secret signature on a stale timestamp reports the timestamp:
    // it distinguishes a clock problem from an attack in the event log.
    const stale = buildSignatureHeader('b'.repeat(64), BODY, new Date(NOW.getTime() - 3_600_000));
    expect(verifySignedPayload({ secret: SECRET, rawBody: BODY, header: stale, now: NOW })).toEqual(
      { ok: false, reason: 'stale_timestamp' },
    );
  });
});
