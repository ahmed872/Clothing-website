import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/modules/core';
import { createUser } from '@/modules/identity';
import { resetIdentityTables } from '@/modules/identity/testing';
import { resetCustomerTables } from '@/modules/customers/testing';

/**
 * The outbox dispatcher (P13 §6/§7/§14) — every property the phase spec
 * names gets its own test: the atomic claim under real concurrency, retry
 * with backoff after a transient failure, no infinite retry after a
 * permanent one or a spent budget, and that a row already resolved (`SENT`
 * or `FAILED`) can never be reopened by a stale worker. All of this is
 * proved against the real database, not a mock of it — the claim's safety
 * comes from Postgres's own row locking, which a mock cannot stand in for.
 *
 * Only `getEmailProvider` is mocked; `EmailSendError`/`isEmailSendError`/the
 * template builders stay real, so the dispatcher's own classification logic
 * (which errors retry, which don't) is exercised as written.
 */

const sendMock = vi.fn();
vi.mock('@/modules/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/notifications')>();
  return { ...actual, getEmailProvider: () => ({ name: 'test' as const, send: sendMock }) };
});

const { dispatchPendingEmailEvents } = await import('./email-dispatcher');
const { EmailSendError } = await import('@/modules/notifications');

beforeEach(async () => {
  await resetCustomerTables();
  await resetIdentityTables();
  sendMock.mockReset();
});

async function customer(email = 'shopper@example.com') {
  return createUser({ email, password: 'correct-horse-9', role: 'CUSTOMER', name: 'Shopper' });
}

async function queueVerification(userId: string) {
  return db.outboxEvent.create({
    data: { type: 'customer.email_verification_requested', payload: { userId } },
  });
}

async function queueReset(userId: string) {
  return db.outboxEvent.create({
    data: { type: 'customer.password_reset_requested', payload: { userId } },
  });
}

describe('dispatchPendingEmailEvents — happy path', () => {
  it('sends a queued verification email and marks the event SENT', async () => {
    const user = await customer();
    await queueVerification(user.id);
    sendMock.mockResolvedValue({ providerMessageId: 'msg_1' });

    const summary = await dispatchPendingEmailEvents();
    expect(summary).toEqual({ claimed: 1, sent: 1, retried: 0, failed: 0, reclaimed: 0 });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]![0]).toMatchObject({ to: user.email, toName: 'Shopper' });

    const event = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'customer.email_verification_requested' },
    });
    expect(event.status).toBe('SENT');
    expect(event.sentAt).not.toBeNull();

    // The dispatcher minted a real, usable token — not a placeholder.
    expect(await db.emailVerificationToken.count({ where: { userId: user.id } })).toBe(1);
  });

  it('sends a queued password-reset email the same way', async () => {
    const user = await customer();
    await queueReset(user.id);
    sendMock.mockResolvedValue({ providerMessageId: 'msg_2' });

    const summary = await dispatchPendingEmailEvents();
    expect(summary).toEqual({ claimed: 1, sent: 1, retried: 0, failed: 0, reclaimed: 0 });

    const event = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'customer.password_reset_requested' },
    });
    expect(event.status).toBe('SENT');
    expect(await db.passwordResetToken.count({ where: { userId: user.id } })).toBe(1);
  });

  it('never touches an event type it does not own (order.*/payment.*)', async () => {
    await db.outboxEvent.create({ data: { type: 'order.created', payload: {} } });
    const summary = await dispatchPendingEmailEvents();
    expect(summary).toEqual({ claimed: 0, sent: 0, retried: 0, failed: 0, reclaimed: 0 });
    expect(sendMock).not.toHaveBeenCalled();

    const event = await db.outboxEvent.findFirstOrThrow({ where: { type: 'order.created' } });
    expect(event.status).toBe('PENDING');
  });
});

describe('dispatchPendingEmailEvents — retry and failure', () => {
  it('actually observes PENDING -> SENDING -> PENDING around a transient failure, not just the two endpoints (P14 §9 Journey C)', async () => {
    const user = await customer();
    await queueVerification(user.id);

    let observedSendingMidFlight = false;
    sendMock.mockImplementation(async () => {
      // The claim (PENDING -> SENDING) happens before `sendForEvent` is
      // ever called — reading the row from inside the mocked send proves
      // the row is genuinely SENDING at the moment a real provider call
      // would be in flight, not merely inferred from the two states
      // before and after `dispatchPendingEmailEvents` resolves.
      const inFlight = await db.outboxEvent.findFirstOrThrow({
        where: { type: 'customer.email_verification_requested' },
      });
      observedSendingMidFlight = inFlight.status === 'SENDING';
      throw new EmailSendError('transient', 'simulated timeout');
    });

    await dispatchPendingEmailEvents();

    expect(observedSendingMidFlight).toBe(true);
    const after = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'customer.email_verification_requested' },
    });
    expect(after.status).toBe('PENDING');
  });

  it('a transient failure goes back to PENDING with attempts advanced and a future nextAttemptAt', async () => {
    const user = await customer();
    await queueVerification(user.id);
    sendMock.mockRejectedValue(new EmailSendError('transient', 'simulated timeout'));

    const before = Date.now();
    const summary = await dispatchPendingEmailEvents();
    expect(summary).toEqual({ claimed: 1, sent: 0, retried: 1, failed: 0, reclaimed: 0 });

    const event = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'customer.email_verification_requested' },
    });
    expect(event.status).toBe('PENDING');
    expect(event.attempts).toBe(1);
    expect(event.lastError).toContain('simulated timeout');
    expect(event.nextAttemptAt.getTime()).toBeGreaterThan(before);
  });

  it('is not re-claimed before nextAttemptAt arrives', async () => {
    const user = await customer();
    await queueVerification(user.id);
    sendMock.mockRejectedValueOnce(new EmailSendError('transient', 'first attempt fails'));

    await dispatchPendingEmailEvents();
    expect(sendMock).toHaveBeenCalledTimes(1);

    // The backoff window has not elapsed — a second dispatch right away
    // must claim nothing.
    const again = await dispatchPendingEmailEvents();
    expect(again).toEqual({ claimed: 0, sent: 0, retried: 0, failed: 0, reclaimed: 0 });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('succeeds on retry once nextAttemptAt has passed', async () => {
    const user = await customer();
    await queueVerification(user.id);
    sendMock.mockRejectedValueOnce(new EmailSendError('transient', 'first attempt fails'));
    sendMock.mockResolvedValueOnce({ providerMessageId: 'msg_retry' });

    await dispatchPendingEmailEvents();
    await db.outboxEvent.updateMany({
      where: { type: 'customer.email_verification_requested' },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });

    const summary = await dispatchPendingEmailEvents();
    expect(summary).toEqual({ claimed: 1, sent: 1, retried: 0, failed: 0, reclaimed: 0 });
    expect(sendMock).toHaveBeenCalledTimes(2);

    const event = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'customer.email_verification_requested' },
    });
    expect(event.status).toBe('SENT');
  });

  it('a permanent failure goes straight to FAILED, never retried', async () => {
    const user = await customer();
    await queueVerification(user.id);
    sendMock.mockRejectedValue(new EmailSendError('permanent', 'hard bounce'));

    const summary = await dispatchPendingEmailEvents();
    expect(summary).toEqual({ claimed: 1, sent: 0, retried: 0, failed: 1, reclaimed: 0 });

    const event = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'customer.email_verification_requested' },
    });
    expect(event.status).toBe('FAILED');
    expect(event.attempts).toBe(1);

    // FAILED is terminal — forcing nextAttemptAt into the past must not
    // resurrect it, because the claim query only ever selects PENDING rows.
    await db.outboxEvent.updateMany({
      where: { id: event.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    sendMock.mockClear();
    const again = await dispatchPendingEmailEvents();
    expect(again).toEqual({ claimed: 0, sent: 0, retried: 0, failed: 0, reclaimed: 0 });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('an unclassified thrown error defaults to transient rather than giving up immediately', async () => {
    const user = await customer();
    await queueVerification(user.id);
    sendMock.mockRejectedValue(new Error('some unexpected bug'));

    const summary = await dispatchPendingEmailEvents();
    expect(summary).toEqual({ claimed: 1, sent: 0, retried: 1, failed: 0, reclaimed: 0 });

    const event = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'customer.email_verification_requested' },
    });
    expect(event.status).toBe('PENDING');
  });

  it('exhausting the retry budget on repeated transient failures ends in FAILED, not an infinite loop', async () => {
    const user = await customer();
    await queueVerification(user.id);
    sendMock.mockRejectedValue(new EmailSendError('transient', 'always fails'));

    // Drive it through every attempt by forcing nextAttemptAt into the past
    // between rounds, exactly like a real cron cadence eventually would.
    let lastSummary;
    for (let round = 0; round < 6; round += 1) {
      await db.outboxEvent.updateMany({
        where: { type: 'customer.email_verification_requested' },
        data: { nextAttemptAt: new Date(Date.now() - 1000) },
      });
      const summary = await dispatchPendingEmailEvents();
      lastSummary = summary;
      const event = await db.outboxEvent.findFirstOrThrow({
        where: { type: 'customer.email_verification_requested' },
      });
      if (event.status === 'FAILED') break;
    }

    const event = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'customer.email_verification_requested' },
    });
    expect(event.status).toBe('FAILED');
    expect(event.attempts).toBeLessThanOrEqual(4);
    expect(lastSummary).toEqual({ claimed: 1, sent: 0, retried: 0, failed: 1, reclaimed: 0 });
  });
});

describe('dispatchPendingEmailEvents — concurrency', () => {
  it('two concurrent dispatch runs claiming the same event — only one sends it', async () => {
    const user = await customer();
    await queueVerification(user.id);
    sendMock.mockImplementation(async () => {
      // A real send is not instantaneous — widening the window makes the
      // race between the two calls below meaningful rather than incidental.
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { providerMessageId: 'msg_race' };
    });

    const [a, b] = await Promise.all([dispatchPendingEmailEvents(), dispatchPendingEmailEvents()]);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const totalSent = a.sent + b.sent;
    const totalClaimed = a.claimed + b.claimed;
    expect(totalSent).toBe(1);
    expect(totalClaimed).toBe(1);

    const event = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'customer.email_verification_requested' },
    });
    expect(event.status).toBe('SENT');
  });

  it('a stale claim attempt against an already-SENT row is refused, not reverted', async () => {
    const user = await customer();
    const queued = await queueVerification(user.id);
    sendMock.mockResolvedValue({ providerMessageId: 'msg_done' });
    await dispatchPendingEmailEvents();

    const sentEvent = await db.outboxEvent.findUniqueOrThrow({ where: { id: queued.id } });
    expect(sentEvent.status).toBe('SENT');

    // A late, duplicate worker trying to transition the same row as if it
    // still owned the `SENDING` claim — this is exactly the guard
    // `processOne`'s own `where: { id, status: 'SENDING' }` provides.
    const staleAttempt = await db.outboxEvent.updateMany({
      where: { id: queued.id, status: 'SENDING' },
      data: { status: 'PENDING', attempts: 99 },
    });
    expect(staleAttempt.count).toBe(0);

    const stillSent = await db.outboxEvent.findUniqueOrThrow({ where: { id: queued.id } });
    expect(stillSent.status).toBe('SENT');
    expect(stillSent.attempts).toBe(0);
  });

  it('two concurrent runs over two different events — both are sent, exactly once each', async () => {
    const alice = await customer('alice@example.com');
    const bob = await customer('bob@example.com');
    await queueVerification(alice.id);
    await queueReset(bob.id);
    sendMock.mockResolvedValue({ providerMessageId: 'msg' });

    const [a, b] = await Promise.all([dispatchPendingEmailEvents(), dispatchPendingEmailEvents()]);
    expect(a.claimed + b.claimed).toBe(2);
    expect(a.sent + b.sent).toBe(2);
    expect(sendMock).toHaveBeenCalledTimes(2);

    const recipients = sendMock.mock.calls.map(([message]) => message.to).sort();
    expect(recipients).toEqual(['alice@example.com', 'bob@example.com']);
  });
});

describe('dispatchPendingEmailEvents — payload/user edge cases', () => {
  it('a payload with no userId fails permanently rather than crashing the batch', async () => {
    await db.outboxEvent.create({
      data: { type: 'customer.email_verification_requested', payload: {} },
    });
    const summary = await dispatchPendingEmailEvents();
    expect(summary).toEqual({ claimed: 1, sent: 0, retried: 0, failed: 1, reclaimed: 0 });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('a userId for an account that no longer exists fails permanently', async () => {
    await queueVerification('00000000-0000-4000-8000-000000000000');
    const summary = await dispatchPendingEmailEvents();
    expect(summary).toEqual({ claimed: 1, sent: 0, retried: 0, failed: 1, reclaimed: 0 });
    expect(sendMock).not.toHaveBeenCalled();
  });
});

/**
 * The lease (P14). The atomic claim stops two *live* workers sending the
 * same message; it says nothing about a worker that stops being live — and
 * this dispatcher runs inside serverless invocations, where being killed
 * mid-send (execution limit, deploy, OOM) is ordinary. Before this, such a
 * row stayed `SENDING` for good and its verification or reset link was
 * simply never sent.
 *
 * A killed worker is simulated the only honest way available: by leaving a
 * row exactly as one leaves it — `SENDING`, with its lease stamp in the
 * past — and then running the dispatcher again.
 */
describe('dispatchPendingEmailEvents — a claim is a lease, not a lock', () => {
  async function abandonedClaim(userId: string, attempts = 0) {
    return db.outboxEvent.create({
      data: {
        type: 'customer.email_verification_requested',
        payload: { userId },
        status: 'SENDING',
        attempts,
        // The lease this worker held, already expired.
        nextAttemptAt: new Date(Date.now() - 60_000),
      },
    });
  }

  it('hands back a row whose worker died mid-send, and eventually sends it', async () => {
    const user = await customer();
    const abandoned = await abandonedClaim(user.id);
    sendMock.mockResolvedValue({ providerMessageId: 'msg_reclaimed' });

    const sweep = await dispatchPendingEmailEvents();
    expect(sweep.reclaimed).toBe(1);
    // Back to PENDING with its own backoff — not re-sent in the same tick.
    expect(sweep.sent).toBe(0);
    const requeued = await db.outboxEvent.findUniqueOrThrow({ where: { id: abandoned.id } });
    expect(requeued.status).toBe('PENDING');
    expect(requeued.attempts).toBe(1);
    expect(requeued.lastError).toContain('claim expired');
    expect(requeued.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // Once the backoff has passed it is an ordinary pending message again.
    await db.outboxEvent.update({
      where: { id: abandoned.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    const second = await dispatchPendingEmailEvents();
    expect(second.sent).toBe(1);
    expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: abandoned.id } })).status).toBe(
      'SENT',
    );
  });

  it('leaves a live claim alone — its lease has not expired', async () => {
    const user = await customer();
    const inFlight = await db.outboxEvent.create({
      data: {
        type: 'customer.email_verification_requested',
        payload: { userId: user.id },
        status: 'SENDING',
        nextAttemptAt: new Date(Date.now() + 60_000),
      },
    });

    const summary = await dispatchPendingEmailEvents();
    expect(summary).toEqual({ claimed: 0, sent: 0, retried: 0, failed: 0, reclaimed: 0 });
    expect(sendMock).not.toHaveBeenCalled();
    expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: inFlight.id } })).status).toBe(
      'SENDING',
    );
  });

  it('a claim stamps a lease in the future, so the next tick does not steal it', async () => {
    const user = await customer();
    const queued = await queueVerification(user.id);
    let leaseDuringSend: Date | null = null;
    sendMock.mockImplementation(async () => {
      const row = await db.outboxEvent.findUniqueOrThrow({ where: { id: queued.id } });
      leaseDuringSend = row.nextAttemptAt;
      return { providerMessageId: 'msg_lease' };
    });

    await dispatchPendingEmailEvents();

    expect(leaseDuringSend).not.toBeNull();
    expect(new Date(leaseDuringSend!).getTime()).toBeGreaterThan(Date.now());
  });

  it('a reclaim costs an attempt, so a send that always kills the worker still gives up', async () => {
    const user = await customer();
    // One attempt short of the budget: the next reclaim is the last.
    const abandoned = await abandonedClaim(user.id, 3);

    const summary = await dispatchPendingEmailEvents();
    expect(summary.reclaimed).toBe(1);

    const row = await db.outboxEvent.findUniqueOrThrow({ where: { id: abandoned.id } });
    expect(row.status).toBe('FAILED');
    expect(row.attempts).toBe(4);

    // Terminal: forcing the stamp into the past must not resurrect it.
    await db.outboxEvent.update({
      where: { id: abandoned.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    const again = await dispatchPendingEmailEvents();
    expect(again).toEqual({ claimed: 0, sent: 0, retried: 0, failed: 0, reclaimed: 0 });
  });

  it('never reclaims an event type it does not own', async () => {
    await db.outboxEvent.create({
      data: {
        type: 'order.created',
        payload: {},
        status: 'SENDING',
        nextAttemptAt: new Date(Date.now() - 60_000),
      },
    });

    const summary = await dispatchPendingEmailEvents();
    expect(summary.reclaimed).toBe(0);
    expect(
      (await db.outboxEvent.findFirstOrThrow({ where: { type: 'order.created' } })).status,
    ).toBe('SENDING');
  });

  it('two dispatchers sweeping at once reclaim a row exactly once', async () => {
    const user = await customer();
    await abandonedClaim(user.id);
    sendMock.mockResolvedValue({ providerMessageId: 'msg_race' });

    const [a, b] = await Promise.all([dispatchPendingEmailEvents(), dispatchPendingEmailEvents()]);
    expect(a.reclaimed + b.reclaimed).toBe(1);
    expect(await db.outboxEvent.count({ where: { status: 'PENDING' } })).toBe(1);
  });
});
