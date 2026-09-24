import 'server-only';

import { randomBytes, createHash } from 'node:crypto';

import { db } from '@/modules/core';
import { hashPassword, getUserByEmail, revokeAllUserSessions } from '@/modules/identity';

/**
 * Email verification and password reset (P12 §12/§13).
 *
 * Both flows share one shape, mirrored deliberately from the two token
 * mechanisms this codebase already trusts: `Session.tokenHash` (P06) and
 * `Order.accessTokenHash` (P10). A 32-byte random value is handed to
 * whoever asked for it — here, that would be an email, which P13 owns
 * sending — and only its SHA-256 hash is ever written to the database, so a
 * read of either token table can never itself grant verification or
 * recovery.
 *
 * What this file does not do: send anything, or hold a raw token anywhere
 * durable long enough for an async sender to find it. The two concerns are
 * split deliberately (P13 §5/§20):
 *
 *   "queue…" functions   — called at the moment something happens
 *                           (registration, a reset request). They write
 *                           only an `OutboxEvent` (`{userId}`, no token
 *                           material at all) and mint nothing yet. This is
 *                           the recorded-not-sent pattern P11 used for
 *                           `payment.succeeded` — no code path here
 *                           fabricates delivery.
 *   "create…" functions  — called by P13's dispatcher at the moment it is
 *                           actually about to send, once it has already
 *                           claimed the queued event. Each mints a brand
 *                           new token row and returns the raw value once.
 *
 * The split exists because a raw token cannot be reconstructed from its
 * hash, and P13's dispatcher may run seconds or, after a retry, minutes
 * after the triggering request — long after that request's local `token`
 * variable is gone. Minting at send time instead of at trigger time means
 * the token's TTL also starts from when the customer can actually see the
 * link, not from an invisible moment they were never shown, and it means
 * this file never has to put a raw secret into a durable payload (the
 * `OutboxEvent.payload` a queue function writes carries only `userId`) —
 * the one place P13 §4/§20 says it must never live in plaintext.
 */

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
/** Shorter than email verification on purpose: a password-reset link is the
 * more sensitive of the two — anyone holding it can take over the account —
 * so its window of usefulness to an attacker who intercepts it is smaller. */
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

export interface CreatedToken {
  /** The raw, unhashed value — returned exactly once, to whatever channel
   * will deliver it. Never persisted or logged in this form. */
  token: string;
  expiresAt: Date;
}

/**
 * Records that `userId` should receive a verification email — an outbox
 * event only, no token minted yet (see this file's own top comment). Does
 * not invalidate a still-valid earlier token, and calling this twice is not
 * an error: a customer who requests a second link because the first one
 * didn't arrive should have both eventually work, and single-use (below)
 * means at most one of the tokens each dispatch mints ever succeeds
 * regardless.
 */
export async function queueEmailVerificationEmail(userId: string): Promise<void> {
  await db.outboxEvent.create({
    data: { type: 'customer.email_verification_requested', payload: { userId } },
  });
}

/**
 * Mints a fresh verification token for `userId` and returns its raw value.
 * Called by P13's dispatcher once it has already claimed a queued
 * `customer.email_verification_requested` event — never by a trigger site,
 * and never writes an outbox event itself (its caller already owns one).
 */
export async function createEmailVerificationToken(userId: string): Promise<CreatedToken> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);

  await db.emailVerificationToken.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });

  return { token, expiresAt };
}

export type VerifyEmailResult =
  { ok: true; userId: string } | { ok: false; reason: 'invalid' | 'expired' | 'used' };

/**
 * Consumes a verification token. Every failure — a token that never
 * existed, one that expired, one already used — collapses to the same
 * `'invalid'`/`'expired'`/`'used'` distinction for the *page* to react to
 * (there is no account to enumerate here the way login/reset have one, so
 * naming which case applies costs nothing); what matters is that none of
 * the three can ever mark an account verified.
 *
 * Single-use is enforced by the `UPDATE ... WHERE usedAt IS NULL` claim
 * below, not by the `findUnique` read above it — a plain
 * check-then-act (`if (record.usedAt) …` on a value read before the write)
 * lets two simultaneous requests for the same token both see `usedAt: null`
 * and both proceed. Postgres locks the row for the claim's `UPDATE`, so of
 * two concurrent attempts at most one can still match `usedAt: null` when
 * its turn comes — the same database-arbitrated concurrency P10/P11 use for
 * the idempotency key and the payment slot, applied here instead of trusting
 * an application-level race. The claim and the account mutation share one
 * transaction so a crash between them can never leave a "used" token that
 * never actually verified anything.
 */
export async function verifyEmailToken(rawToken: string): Promise<VerifyEmailResult> {
  const tokenHash = hashToken(rawToken);
  const record = await db.emailVerificationToken.findUnique({ where: { tokenHash } });
  if (!record) return { ok: false, reason: 'invalid' };
  if (record.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };

  return db.$transaction(async (tx) => {
    const claim = await tx.emailVerificationToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claim.count === 0) return { ok: false, reason: 'used' } as const;

    await tx.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    });
    return { ok: true, userId: record.userId } as const;
  });
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

/** Mints a fresh reset token for `userId` and returns its raw value —
 * mirrors `createEmailVerificationToken` exactly, called only by P13's
 * dispatcher once it holds an already-claimed
 * `customer.password_reset_requested` event. Writes no outbox event. */
export async function createPasswordResetToken(userId: string): Promise<CreatedToken> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

  await db.passwordResetToken.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });

  return { token, expiresAt };
}

/**
 * The safe, public entry point (P12 §13's "no account enumeration"): looks
 * up the email, and returns exactly the same `void` whether or not an
 * account exists. The route calling this always shows the same "if an
 * account exists, we sent a link" message regardless of which branch ran.
 * Queues an outbox event only — see this file's own top comment for why no
 * token is minted here.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await getUserByEmail(email);
  // Only ever issued to a CUSTOMER account — an admin's password reset is
  // the admin surface's own concern, not this module's.
  if (!user || user.role !== 'CUSTOMER') return;

  await db.outboxEvent.create({
    data: { type: 'customer.password_reset_requested', payload: { userId: user.id } },
  });
}

export type ResetPasswordResult =
  { ok: true } | { ok: false; reason: 'invalid' | 'expired' | 'used' };

/**
 * Consumes a reset token and sets a new password. As with
 * `verifyEmailToken`, single-use is enforced by an atomic
 * `UPDATE ... WHERE usedAt IS NULL` claim rather than a `findUnique` read
 * followed by a separate write — the gap between them is exactly where two
 * simultaneous submissions of the same link (a slow double click, or a
 * replay racing the legitimate use) could otherwise both read `usedAt: null`
 * and each set a *different* new password. The claim and the password
 * change share one transaction (P12 §13) so a crash between them can never
 * leave a "used" token whose password change never actually happened.
 */
export async function resetPasswordWithToken(
  rawToken: string,
  newPassword: string,
): Promise<ResetPasswordResult> {
  const tokenHash = hashToken(rawToken);
  const record = await db.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!record) return { ok: false, reason: 'invalid' };
  if (record.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };

  const passwordHash = await hashPassword(newPassword);

  const result = await db.$transaction(async (tx) => {
    const claim = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claim.count === 0) return { ok: false, reason: 'used' } as const;

    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    return { ok: true } as const;
  });

  if (result.ok) {
    // Outside the transaction deliberately: this deletes `Session` rows,
    // which is idempotent and safe to retry, and doing it after the
    // password actually committed avoids revoking every session and then
    // failing to change the password at all.
    await revokeAllUserSessions(record.userId);
  }

  return result;
}

export async function isEmailVerified(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true },
  });
  return user?.emailVerifiedAt != null;
}
