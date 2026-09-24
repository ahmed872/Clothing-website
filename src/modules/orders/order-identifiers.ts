import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * The two identifiers an order carries into the world.
 *
 * The number is what a customer reads out on the phone. The access token is
 * what proves a guest may open their own order and nobody else's. They are
 * deliberately different things: one is designed to be spoken, the other to
 * be unguessable, and a single value cannot be both (P10 §2/§14).
 */

/**
 * Crockford base32 minus the letters that get misread aloud or mistyped:
 * I/L/O collide with 1/0, and U is dropped as it is in Crockford's own
 * alphabet. What is left survives being read over a bad phone line.
 */
const NUMBER_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RANDOM_PART_LENGTH = 6;

/**
 * `LD-260902-K7QM4X`
 *
 * The date prefix makes an order sortable and instantly locatable in support
 * ("the one from the 2nd"); the random tail is what stops it being
 * guessable. Sequence numbers are avoided on purpose: `LD-000042` tells a
 * competitor how many orders the store has ever taken, and tells an attacker
 * that `LD-000041` exists (P10 §2).
 *
 * Entropy is 32^6 ≈ 10^9 per day, so a collision inside one day's orders is
 * vanishingly unlikely — and the unique index on `Order.number` means an
 * unlucky one is a retry, never a duplicate.
 */
export function generateOrderNumber(now: Date = new Date()): string {
  const yy = String(now.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');

  let tail = '';
  for (let i = 0; i < RANDOM_PART_LENGTH; i += 1) {
    // `randomInt` is rejection-sampled by Node, so the distribution stays
    // uniform — `randomBytes()[i] % 32` would quietly favour the first bytes
    // of the alphabet.
    tail += NUMBER_ALPHABET[randomInt(NUMBER_ALPHABET.length)];
  }

  return `LD-${yy}${mm}${dd}-${tail}`;
}

/** Shape check only — proves nothing about existence or ownership. Used to
 * reject obviously malformed input before it reaches a query. */
export function isOrderNumberShape(value: string): boolean {
  return /^LD-\d{6}-[0-9A-HJKMNP-TV-Z]{6}$/.test(value);
}

/**
 * A guest's credential for their own order: 32 bytes of randomness, stored
 * only as a SHA-256 hash, exactly as session tokens are (P06).
 *
 * The plaintext lives in the success URL and in an httpOnly cookie. Because
 * only the hash is at rest, a database dump does not open anyone's order,
 * and because the token is separate from the order number, quoting an order
 * number to support leaks nothing.
 */
export function generateOrderAccessToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashOrderAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison of two access-token hashes.
 *
 * Lookups go through the unique index on `access_token_hash` (the database
 * does the matching), so this exists for the cases where a hash is compared
 * in application code — comparing with `===` there would leak, through
 * timing, how many leading characters a guess got right.
 */
export function accessTokenHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
