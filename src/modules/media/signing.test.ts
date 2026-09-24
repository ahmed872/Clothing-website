import { describe, expect, it } from 'vitest';

import { sign, verify } from './signing';

describe('sign / verify', () => {
  const secret = 'a-test-secret-that-is-long-enough';

  it('verifies a signature produced by sign() for the same payload and secret', () => {
    const signature = sign('media/product/abc.jpg:image/jpeg:8000000:1234567890', secret);
    expect(verify('media/product/abc.jpg:image/jpeg:8000000:1234567890', signature, secret)).toBe(
      true,
    );
  });

  it('rejects a tampered payload (same signature, different content)', () => {
    const signature = sign('media/product/abc.jpg:image/jpeg:8000000:1234567890', secret);
    // An attacker upgrading their declared size after the fact.
    expect(verify('media/product/abc.jpg:image/jpeg:99999999:1234567890', signature, secret)).toBe(
      false,
    );
  });

  it('rejects a signature produced with a different secret', () => {
    const signature = sign(
      'media/product/abc.jpg:image/jpeg:8000000:1234567890',
      'wrong-secret-value',
    );
    expect(verify('media/product/abc.jpg:image/jpeg:8000000:1234567890', signature, secret)).toBe(
      false,
    );
  });

  it('rejects a garbage signature of the wrong length', () => {
    expect(
      verify('media/product/abc.jpg:image/jpeg:8000000:1234567890', 'not-a-real-signature', secret),
    ).toBe(false);
  });

  it('rejects an empty signature', () => {
    expect(verify('media/product/abc.jpg:image/jpeg:8000000:1234567890', '', secret)).toBe(false);
  });
});
