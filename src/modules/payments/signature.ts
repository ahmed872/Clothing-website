import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signature verification (P11 §10).
 *
 * The scheme is the conventional one every major processor uses, and it is
 * implemented here rather than taken from an SDK so its properties are
 * visible and testable:
 *
 *   signature = HMAC-SHA256(secret, "<timestamp>.<raw body>")
 *
 * Three things matter, and each is a defect if missing:
 *
 *   the raw bytes  — a signature covers exactly what was sent. Parsing the
 *                    JSON and re-serialising it before checking changes key
 *                    order and whitespace, and the check silently starts
 *                    passing nothing.
 *   the timestamp  — inside the signed string, so an attacker who captures a
 *                    valid delivery cannot replay it forever. Outside a
 *                    tolerance window the delivery is refused even with a
 *                    perfect signature.
 *   constant time  — `timingSafeEqual`, not `===`. A byte-by-byte compare
 *                    that returns early leaks the expected signature one
 *                    character at a time to anyone willing to measure.
 */

/** How far a delivery's timestamp may be from now, in either direction.
 * Wide enough for a slow retry and a few seconds of clock drift; far short
 * of useful for replaying a captured request tomorrow. */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export interface SignatureParts {
  timestamp: number;
  signature: string;
}

/**
 * Parses the `t=<unix seconds>,v1=<hex>` header form.
 *
 * Returns null rather than throwing: a malformed header is an ordinary
 * rejection, not an exception, and the caller records it as one.
 */
export function parseSignatureHeader(header: string | null): SignatureParts | null {
  if (!header) return null;
  let timestamp: number | null = null;
  let signature: string | null = null;

  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === 't') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) timestamp = parsed;
    } else if (key === 'v1') {
      signature = value;
    }
  }

  if (timestamp === null || !signature) return null;
  return { timestamp, signature };
}

export function computeSignature(secret: string, timestamp: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

const HEX = /^[0-9a-f]+$/i;

/**
 * Constant-time comparison of two hex signatures.
 *
 * Both inputs are checked for hex shape *before* decoding, and that check is
 * not decoration. `Buffer.from('zzzz', 'hex')` does not throw — Node stops at
 * the first invalid pair and returns an empty buffer — so two equal-length
 * non-hex strings decode to two empty buffers and `timingSafeEqual` happily
 * calls them equal. Written first without this guard, and caught by the test
 * below it.
 *
 * Length is compared before the constant-time step because `timingSafeEqual`
 * throws on differing lengths, and a signature's length is not a secret.
 */
export function signaturesMatch(expected: string, provided: string): boolean {
  if (expected.length !== provided.length) return false;
  if (expected.length === 0) return false;
  if (!HEX.test(expected) || !HEX.test(provided)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
}

export type SignatureCheck =
  { ok: true } | { ok: false; reason: 'missing_signature' | 'bad_signature' | 'stale_timestamp' };

export function verifySignedPayload(args: {
  secret: string;
  rawBody: string;
  header: string | null;
  now?: Date;
  toleranceSeconds?: number;
}): SignatureCheck {
  const parts = parseSignatureHeader(args.header);
  if (!parts) return { ok: false, reason: 'missing_signature' };

  const nowSeconds = Math.floor((args.now ?? new Date()).getTime() / 1000);
  const tolerance = args.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - parts.timestamp) > tolerance) {
    // Checked before the HMAC on purpose: a stale delivery is refused
    // whether or not its signature is valid, and saying so distinguishes a
    // clock problem from an attack in the webhook event log.
    return { ok: false, reason: 'stale_timestamp' };
  }

  const expected = computeSignature(args.secret, parts.timestamp, args.rawBody);
  return signaturesMatch(expected, parts.signature)
    ? { ok: true }
    : { ok: false, reason: 'bad_signature' };
}

/**
 * Builds the header a provider would send. Exported because the tests need
 * to produce genuinely valid deliveries — signing a fixture with the
 * configured secret exercises the real verification path, where handing the
 * handler a pre-approved object would exercise nothing.
 */
export function buildSignatureHeader(secret: string, rawBody: string, now: Date): string {
  const timestamp = Math.floor(now.getTime() / 1000);
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, rawBody)}`;
}
