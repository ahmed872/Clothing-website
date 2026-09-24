import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC signing for the local storage provider's upload URLs — its equivalent
 * of the signature AWS computes for a real presigned URL. Kept as its own
 * small, pure-ish module (one side effect: reads the secret) so the
 * signature contract can be unit tested without any storage or database
 * involved.
 */

export function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Constant-time comparison — a `===` here would leak timing information
 * about how many leading bytes of the signature matched. */
export function verify(payload: string, signature: string, secret: string): boolean {
  const expected = sign(payload, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
