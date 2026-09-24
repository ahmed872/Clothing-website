import { describe, expect, it } from 'vitest';

import {
  InMemoryRateLimiter,
  PASSWORD_RESET_RATE_LIMIT,
  RESEND_VERIFICATION_RATE_LIMIT,
  getPasswordResetRateLimiter,
  getResendVerificationRateLimiter,
  resetPasswordResetRateLimiter,
  resetResendVerificationRateLimiter,
} from './rate-limiter';

describe('InMemoryRateLimiter', () => {
  it('allows attempts up to the limit within the window', async () => {
    const limiter = new InMemoryRateLimiter({ limit: 3, windowMs: 60_000 });
    expect((await limiter.check('k')).allowed).toBe(true);
    expect((await limiter.check('k')).allowed).toBe(true);
    expect((await limiter.check('k')).allowed).toBe(true);
  });

  it('blocks the attempt after the limit is reached, with a positive retryAfterMs', async () => {
    const limiter = new InMemoryRateLimiter({ limit: 2, windowMs: 60_000 });
    await limiter.check('k');
    await limiter.check('k');
    const blocked = await limiter.check('k');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.remaining).toBe(0);
  });

  it('tracks each key independently', async () => {
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 60_000 });
    await limiter.check('a');
    const blockedA = await limiter.check('a');
    const firstB = await limiter.check('b');
    expect(blockedA.allowed).toBe(false);
    expect(firstB.allowed).toBe(true);
  });

  it('resets the window once it elapses', async () => {
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 10 });
    await limiter.check('k');
    expect((await limiter.check('k')).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await limiter.check('k')).allowed).toBe(true);
  });

  it('reset() clears every tracked key', async () => {
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 60_000 });
    await limiter.check('k');
    expect((await limiter.check('k')).allowed).toBe(false);
    limiter.reset();
    expect((await limiter.check('k')).allowed).toBe(true);
  });
});

/** P13 §10 — email-triggering actions must not become spam mechanisms. */
describe('getPasswordResetRateLimiter', () => {
  it('is a shared singleton, not a fresh limiter per call', async () => {
    resetPasswordResetRateLimiter();
    const limiter = getPasswordResetRateLimiter();
    expect(getPasswordResetRateLimiter()).toBe(limiter);
  });

  it('allows exactly PASSWORD_RESET_RATE_LIMIT.limit requests, then blocks', async () => {
    resetPasswordResetRateLimiter();
    const limiter = getPasswordResetRateLimiter();
    const key = 'shopper@example.com';
    for (let i = 0; i < PASSWORD_RESET_RATE_LIMIT.limit; i += 1) {
      expect((await limiter.check(key)).allowed).toBe(true);
    }
    expect((await limiter.check(key)).allowed).toBe(false);
  });

  it('tracks each email independently, so one address cannot exhaust another’s budget', async () => {
    resetPasswordResetRateLimiter();
    const limiter = getPasswordResetRateLimiter();
    for (let i = 0; i < PASSWORD_RESET_RATE_LIMIT.limit; i += 1) {
      await limiter.check('victim@example.com');
    }
    expect((await limiter.check('victim@example.com')).allowed).toBe(false);
    expect((await limiter.check('someone-else@example.com')).allowed).toBe(true);
  });
});

describe('getResendVerificationRateLimiter', () => {
  it('is a shared singleton, not a fresh limiter per call', async () => {
    resetResendVerificationRateLimiter();
    const limiter = getResendVerificationRateLimiter();
    expect(getResendVerificationRateLimiter()).toBe(limiter);
  });

  it('allows exactly RESEND_VERIFICATION_RATE_LIMIT.limit requests per userId, then blocks', async () => {
    resetResendVerificationRateLimiter();
    const limiter = getResendVerificationRateLimiter();
    const userId = 'user-1';
    for (let i = 0; i < RESEND_VERIFICATION_RATE_LIMIT.limit; i += 1) {
      expect((await limiter.check(userId)).allowed).toBe(true);
    }
    expect((await limiter.check(userId)).allowed).toBe(false);
  });
});
