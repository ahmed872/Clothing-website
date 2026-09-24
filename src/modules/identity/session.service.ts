import 'server-only';

import { randomBytes, createHash } from 'node:crypto';

import { db } from '@/modules/core';

/**
 * The DB-backed session — the true source of truth for revocability.
 *
 * Auth.js (see `auth.ts`) uses the JWT session strategy for its cookie and
 * CSRF handling, but a bare JWT cannot be revoked before it naturally
 * expires: there is no way to force-logout a stolen token, disable a user
 * mid-session, or invalidate every session on a password change. So every
 * signed-in session also gets a row here, and the JWT carries only an opaque
 * pointer to it (`dbSessionToken`). `auth.ts`'s `jwt` callback re-validates
 * that pointer against this table (and the live user) on every request,
 * returning `null` — Auth.js's documented signal to invalidate the token —
 * the moment the row is gone, expired, or the user is no longer eligible.
 *
 * The raw token is a 32-byte random value handed to the client only inside
 * the encrypted JWT; the table stores its SHA-256 hash, never the raw value
 * itself — the same "never store the secret you can hash instead" posture
 * `password.ts` already applies to login passwords.
 */

/** 12 hours — long enough that a legitimate admin shift isn't interrupted,
 * short enough that a forgotten signed-in browser doesn't stay valid for
 * days. Reducible per-deployment later without any schema change. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface CreateSessionInput {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
  /** Defaults to `SESSION_TTL_MS` (the admin shift length). The storefront
   * customer auth passes its own, much longer TTL (P12 §6) — a shopper
   * expects "stay signed in," an admin's 12-hour shift session does not.
   * One function, one revocation mechanism, two honestly different
   * lifetimes for two different audiences. */
  ttlMs?: number;
}

export interface DbSessionResult {
  /** The raw, unhashed token — only ever returned here, to be embedded in
   * the JWT. Never persisted or logged in this form. */
  token: string;
  expiresAt: Date;
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export async function createDbSession(input: CreateSessionInput): Promise<DbSessionResult> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? SESSION_TTL_MS));

  await db.session.create({
    data: {
      userId: input.userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });

  return { token, expiresAt };
}

/**
 * True when `rawToken` names a session row that still exists and has not
 * expired. Does not check the user's active status or role — callers that
 * need the live user (the `jwt` callback does) fetch it separately so a
 * role change or disable takes effect immediately without waiting on
 * session expiry.
 */
export async function validateDbSession(rawToken: string): Promise<{ userId: string } | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { userId: true, expiresAt: true },
  });

  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  return { userId: session.userId };
}

/** Logout: deletes exactly the one session row the caller's token names. */
export async function revokeDbSession(rawToken: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: hashToken(rawToken) } });
}

/** Force-logout everywhere: password change, role change, or admin-initiated
 * "sign this user out of all devices." */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId } });
}
