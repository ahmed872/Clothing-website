import 'server-only';

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { z } from 'zod';

/**
 * Password hashing and policy.
 *
 * `scrypt` via Node's own `node:crypto` — no external hashing dependency
 * (`bcrypt`/`argon2` both need a native build step that's a real risk to
 * pull off reliably in every environment this runs in; `scrypt` is
 * OWASP-recommended, memory-hard, and ships in Node itself). The stored
 * format is self-describing (`scrypt:<salt>:<hash>`) so the scheme can
 * change later without a data migration — a verify call that sees an
 * unrecognized scheme just fails closed rather than guessing.
 */

const scrypt = promisify(scryptCallback);

const SCHEME = 'scrypt';
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${SCHEME}:${salt}:${derived.toString('hex')}`;
}

/** Constant-time comparison — a timing difference between "wrong password"
 * and "right password" is itself a side channel an attacker can measure. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  const [scheme, salt, hashHex] = parts;
  if (scheme !== SCHEME || !salt || !hashHex) return false;

  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const stored_ = Buffer.from(hashHex, 'hex');
  if (stored_.length !== derived.length) return false;
  return timingSafeEqual(derived, stored_);
}

/**
 * Policy: 12+ characters, at least one letter and one number. No forced
 * special-character/uppercase rules — those push people toward predictable
 * substitutions ("Password1!") without meaningfully raising entropy, and
 * this is length-first policy is what NIST 800-63B now recommends over
 * complexity rules. 12 rather than 8 because every account this creates is
 * an admin account with real store-operating privilege, not a customer
 * signup.
 */
export const passwordPolicySchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password is too long')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export function validatePasswordPolicy(password: string): string | null {
  const result = passwordPolicySchema.safeParse(password);
  if (result.success) return null;
  return result.error.issues[0]?.message ?? 'Invalid password';
}

/**
 * The storefront policy (P12 §4): 8+ characters, same letter-and-number
 * shape, same NIST 800-63B length-first reasoning as the admin policy above
 * — but 8 rather than 12, because a customer account carries no
 * store-operating privilege. Hashing and verification are policy-agnostic
 * (`hashPassword`/`verifyPassword` above) and are reused as-is; only the
 * acceptable-shape rule differs by audience.
 */
export const customerPasswordPolicySchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export function validateCustomerPasswordPolicy(password: string): string | null {
  const result = customerPasswordPolicySchema.safeParse(password);
  if (result.success) return null;
  return result.error.issues[0]?.message ?? 'Invalid password';
}
