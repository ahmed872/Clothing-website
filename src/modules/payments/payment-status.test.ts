import { describe, expect, it } from 'vitest';

import {
  LIVE_ATTEMPT_STATUSES,
  PAYMENT_ATTEMPT_TRANSITIONS,
  TERMINAL_ATTEMPT_STATUSES,
  canTransitionAttempt,
  isLiveAttempt,
  isNewerEvent,
  isTerminalAttempt,
  orderPaymentStatusFor,
} from './payment-status';

/**
 * The attempt machine, with no database in sight. Every edge is asserted
 * both ways round — allowing a move nobody should make is the same class of
 * bug as refusing one everybody needs.
 */

describe('payment attempt machine', () => {
  it('lets a fresh session end any way the provider might end it', () => {
    for (const to of [
      'REQUIRES_ACTION',
      'PENDING',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
      'EXPIRED',
    ] as const) {
      expect(canTransitionAttempt('CREATED', to)).toBe(true);
    }
  });

  it('will not let a settled attempt move again', () => {
    for (const from of TERMINAL_ATTEMPT_STATUSES) {
      expect(PAYMENT_ATTEMPT_TRANSITIONS[from]).toHaveLength(0);
      expect(canTransitionAttempt(from, 'SUCCEEDED')).toBe(false);
      expect(canTransitionAttempt(from, 'PENDING')).toBe(false);
    }
  });

  it('never walks a successful payment backwards', () => {
    expect(canTransitionAttempt('SUCCEEDED', 'PENDING')).toBe(false);
    expect(canTransitionAttempt('SUCCEEDED', 'FAILED')).toBe(false);
    expect(canTransitionAttempt('SUCCEEDED', 'CANCELLED')).toBe(false);
  });

  it('does not offer cancellation once the provider has it', () => {
    // The money may already be moving and only the provider knows; the way
    // out of PENDING is an outcome, not a decision of ours.
    expect(canTransitionAttempt('PENDING', 'CANCELLED')).toBe(false);
    expect(canTransitionAttempt('PENDING', 'SUCCEEDED')).toBe(true);
    expect(canTransitionAttempt('PENDING', 'FAILED')).toBe(true);
    expect(canTransitionAttempt('PENDING', 'EXPIRED')).toBe(true);
  });

  it('never transitions a status to itself', () => {
    for (const [from, targets] of Object.entries(PAYMENT_ATTEMPT_TRANSITIONS)) {
      expect(targets).not.toContain(from);
    }
  });

  it('splits every status into exactly one of live or terminal', () => {
    const all = Object.keys(PAYMENT_ATTEMPT_TRANSITIONS);
    expect([...LIVE_ATTEMPT_STATUSES, ...TERMINAL_ATTEMPT_STATUSES].sort()).toEqual(all.sort());
    for (const status of LIVE_ATTEMPT_STATUSES) {
      expect(isLiveAttempt(status)).toBe(true);
      expect(isTerminalAttempt(status)).toBe(false);
    }
  });
});

describe('attempt status → order payment status', () => {
  it('only ever says PAID for a succeeded attempt', () => {
    const paid = Object.keys(PAYMENT_ATTEMPT_TRANSITIONS).filter(
      (status) => orderPaymentStatusFor(status as never) === 'PAID',
    );
    expect(paid).toEqual(['SUCCEEDED']);
  });

  it('treats an open session as pending money, not paid money', () => {
    expect(orderPaymentStatusFor('CREATED')).toBe('PENDING');
    expect(orderPaymentStatusFor('REQUIRES_ACTION')).toBe('PENDING');
    expect(orderPaymentStatusFor('PENDING')).toBe('PENDING');
  });

  it('does not record a decline for a session nobody declined', () => {
    // Walking away is not the same as being refused, and an order that was
    // abandoned has to become payable again.
    expect(orderPaymentStatusFor('CANCELLED')).toBe('UNPAID');
    expect(orderPaymentStatusFor('EXPIRED')).toBe('UNPAID');
    expect(orderPaymentStatusFor('FAILED')).toBe('FAILED');
  });
});

describe('event ordering', () => {
  const t = (iso: string) => new Date(iso);

  it('accepts the first event an attempt ever sees', () => {
    expect(isNewerEvent(null, t('2026-09-02T10:00:00Z'))).toBe(true);
  });

  it('accepts a strictly newer event', () => {
    expect(isNewerEvent(t('2026-09-02T10:00:00Z'), t('2026-09-02T10:00:01Z'))).toBe(true);
  });

  it('refuses a stale redelivery, and a re-delivery of the same instant', () => {
    // The delayed PENDING arriving after SUCCEEDED — the case that would
    // otherwise walk a paid order backwards.
    expect(isNewerEvent(t('2026-09-02T10:00:05Z'), t('2026-09-02T10:00:01Z'))).toBe(false);
    expect(isNewerEvent(t('2026-09-02T10:00:05Z'), t('2026-09-02T10:00:05Z'))).toBe(false);
  });
});
