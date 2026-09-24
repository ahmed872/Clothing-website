import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';
import { createUser, verifyPassword } from '@/modules/identity';
import { createDbSession } from '@/modules/identity/session.service';
import { resetIdentityTables } from '@/modules/identity/testing';

import {
  createEmailVerificationToken,
  createPasswordResetToken,
  isEmailVerified,
  queueEmailVerificationEmail,
  requestPasswordReset,
  resetPasswordWithToken,
  verifyEmailToken,
} from './token.service';
import { resetCustomerTables } from './testing';

/**
 * The email-verification / password-reset token domain (P12 §12/§13).
 *
 * Every failure mode named in the phase spec gets its own test here: a
 * token that never existed, one that expired, one already used, and —
 * because "single-use" is a promise about concurrent requests, not just
 * sequential ones — two simultaneous attempts to consume the same token
 * (P12 §27's concurrency requirement, the same discipline P10/P11 already
 * applied to the idempotency key and the payment slot).
 */

beforeEach(async () => {
  await resetCustomerTables();
  await resetIdentityTables();
});

async function customer(email = 'shopper@example.com') {
  return createUser({ email, password: 'correct-horse-9', role: 'CUSTOMER' });
}

/**
 * P13 §5/§20 split this file's original single "create a token and queue an
 * outbox event in one transaction" function into two: `queueEmailVerification
 * Email` (an outbox event only, called at the trigger) and
 * `createEmailVerificationToken` (mints the token, called only by the
 * dispatcher once it has already claimed a queued event). This is a
 * documented, justified rewrite — the original test asserted a shape this
 * function no longer has, not a behavior that regressed: no plaintext token
 * ever needs to survive in a durable payload between "something happened"
 * and "the dispatcher is about to send", which is the entire reason for the
 * split (see `token.service.ts`'s own top comment).
 */
describe('queueEmailVerificationEmail', () => {
  it('records an outbox event without minting any token', async () => {
    const user = await customer();
    await queueEmailVerificationEmail(user.id);

    const events = await db.outboxEvent.findMany({
      where: { type: 'customer.email_verification_requested' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ userId: user.id });

    expect(await db.emailVerificationToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it('queuing twice records two events — a second request should still eventually be delivered', async () => {
    const user = await customer();
    await queueEmailVerificationEmail(user.id);
    await queueEmailVerificationEmail(user.id);

    expect(
      await db.outboxEvent.count({ where: { type: 'customer.email_verification_requested' } }),
    ).toBe(2);
  });
});

describe('createEmailVerificationToken', () => {
  it('mints a token row without writing an outbox event — that is the queue function’s job', async () => {
    const user = await customer();
    const before = await db.outboxEvent.count();
    const { token, expiresAt } = await createEmailVerificationToken(user.id);

    expect(token).toHaveLength(43); // 32 random bytes, base64url
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const rows = await db.emailVerificationToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(token); // only the hash is stored
    expect(await db.outboxEvent.count()).toBe(before);
  });

  it('does not invalidate an earlier still-valid token when a second one is requested', async () => {
    const user = await customer();
    const first = await createEmailVerificationToken(user.id);
    await createEmailVerificationToken(user.id);

    const result = await verifyEmailToken(first.token);
    expect(result).toEqual({ ok: true, userId: user.id });
  });
});

describe('verifyEmailToken', () => {
  it('verifies the account and marks the token used', async () => {
    const user = await customer();
    const { token } = await createEmailVerificationToken(user.id);

    const result = await verifyEmailToken(token);
    expect(result).toEqual({ ok: true, userId: user.id });

    const refreshed = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(refreshed.emailVerifiedAt).not.toBeNull();

    const row = await db.emailVerificationToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.usedAt).not.toBeNull();
  });

  it('rejects a token that never existed', async () => {
    const result = await verifyEmailToken('this-token-was-never-issued');
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects an already-used token — replay does not re-verify or re-succeed', async () => {
    const user = await customer();
    const { token } = await createEmailVerificationToken(user.id);
    await verifyEmailToken(token);

    const replay = await verifyEmailToken(token);
    expect(replay).toEqual({ ok: false, reason: 'used' });
  });

  it('rejects an expired token without verifying the account', async () => {
    const user = await customer();
    const { token } = await createEmailVerificationToken(user.id);
    await db.emailVerificationToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await verifyEmailToken(token);
    expect(result).toEqual({ ok: false, reason: 'expired' });

    const refreshed = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(refreshed.emailVerifiedAt).toBeNull();
  });

  it('two simultaneous attempts to consume the same token — at most one succeeds', async () => {
    const user = await customer();
    const { token } = await createEmailVerificationToken(user.id);

    const [a, b] = await Promise.all([verifyEmailToken(token), verifyEmailToken(token)]);
    const outcomes = [a, b];
    const succeeded = outcomes.filter((r) => r.ok);
    expect(succeeded).toHaveLength(1);
  });
});

describe('isEmailVerified', () => {
  it('is false before verification and true after', async () => {
    const user = await customer();
    expect(await isEmailVerified(user.id)).toBe(false);

    const { token } = await createEmailVerificationToken(user.id);
    await verifyEmailToken(token);
    expect(await isEmailVerified(user.id)).toBe(true);
  });
});

/**
 * `requestPasswordReset` now only queues the outbox event (P13 §5/§20's
 * split — see `queueEmailVerificationEmail`'s own comment above for the
 * identical reasoning applied here); minting the actual reset token is
 * `createPasswordResetToken`, called only by the dispatcher.
 */
describe('requestPasswordReset — no account enumeration (P12 §13/§21)', () => {
  it('queues a reset outbox event for an existing customer, without minting a token', async () => {
    const user = await customer();
    await requestPasswordReset('shopper@example.com');

    const events = await db.outboxEvent.findMany({
      where: { type: 'customer.password_reset_requested' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ userId: user.id });
    expect(await db.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it('is a silent no-op for an email that does not exist', async () => {
    await expect(requestPasswordReset('nobody@example.com')).resolves.toBeUndefined();
    expect(
      await db.outboxEvent.count({ where: { type: 'customer.password_reset_requested' } }),
    ).toBe(0);
  });

  it('is a silent no-op for an admin account — password reset is a customer-only entry point', async () => {
    await createUser({ email: 'owner@example.com', password: 'correct-horse-9', role: 'OWNER' });
    await requestPasswordReset('owner@example.com');
    expect(
      await db.outboxEvent.count({ where: { type: 'customer.password_reset_requested' } }),
    ).toBe(0);
  });
});

describe('createPasswordResetToken', () => {
  it('mints a token row storing only its hash — never the raw value (P14 §8)', async () => {
    const user = await customer();
    const before = await db.outboxEvent.count();
    const { token, expiresAt } = await createPasswordResetToken(user.id);

    expect(token).toHaveLength(43); // 32 random bytes, base64url
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const rows = await db.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(token); // only the hash is stored
    expect(rows[0]!.tokenHash).not.toContain(token);
    expect(await db.outboxEvent.count()).toBe(before);
  });
});

describe('resetPasswordWithToken', () => {
  it('changes the password and revokes every active session for the account', async () => {
    const user = await customer();
    await createDbSession({ userId: user.id });
    await createDbSession({ userId: user.id });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(2);

    const { token } = await createPasswordResetToken(user.id);
    const result = await resetPasswordWithToken(token, 'new-correct-horse-1');
    expect(result).toEqual({ ok: true });

    const refreshed = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword('new-correct-horse-1', refreshed.passwordHash!)).toBe(true);
    expect(await verifyPassword('correct-horse-9', refreshed.passwordHash!)).toBe(false);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('rejects a token that never existed, and changes nothing', async () => {
    const user = await customer();
    const result = await resetPasswordWithToken('never-issued', 'new-correct-horse-1');
    expect(result).toEqual({ ok: false, reason: 'invalid' });

    const refreshed = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword('correct-horse-9', refreshed.passwordHash!)).toBe(true);
  });

  it('rejects an expired token', async () => {
    const user = await customer();
    const { token } = await createPasswordResetToken(user.id);
    await db.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await resetPasswordWithToken(token, 'new-correct-horse-1');
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a replayed, already-used token', async () => {
    const user = await customer();
    const { token } = await createPasswordResetToken(user.id);
    await resetPasswordWithToken(token, 'new-correct-horse-1');

    const replay = await resetPasswordWithToken(token, 'another-correct-horse-2');
    expect(replay).toEqual({ ok: false, reason: 'used' });

    // The first reset is the one that stands — a rejected replay must not
    // have changed the password a second time.
    const refreshed = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword('new-correct-horse-1', refreshed.passwordHash!)).toBe(true);
  });

  it('two simultaneous resets with the same token — at most one succeeds', async () => {
    const user = await customer();
    const { token } = await createPasswordResetToken(user.id);

    const [a, b] = await Promise.all([
      resetPasswordWithToken(token, 'password-attempt-one-1'),
      resetPasswordWithToken(token, 'password-attempt-two-2'),
    ]);
    const succeeded = [a, b].filter((r) => r.ok);
    expect(succeeded).toHaveLength(1);
  });
});
