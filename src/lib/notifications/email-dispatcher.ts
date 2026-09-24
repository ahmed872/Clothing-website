import 'server-only';

import { clientEnv, db } from '@/modules/core';
import { getUserById } from '@/modules/identity';
import { createEmailVerificationToken, createPasswordResetToken } from '@/modules/customers';
import {
  buildPasswordResetEmail,
  buildVerificationEmail,
  EmailSendError,
  getEmailProvider,
  isEmailSendError,
  type EmailCopy,
} from '@/modules/notifications';
import { getDictionary } from '@/lib/i18n/dictionary';
import type { Locale } from '@/lib/i18n/locales';

/**
 * Drains the outbox (P13 §5/§6/§7/§14) — the composition point that crosses
 * `identity`/`customers`/`notifications`/`core` together, the same
 * `src/lib` pattern `customer-identity.ts` already established in P12 for
 * exactly this reason (`notifications` may depend on `core`/`settings`
 * only; `customers` may not depend on `notifications`; something has to
 * sit above both).
 *
 * Every event type this dispatcher does not recognise (`order.*`,
 * `payment.*`, written by P10/P11) is left alone: the claim query below
 * filters by `type`, so those rows simply keep waiting for whichever later
 * phase implements their delivery — this file never touches them.
 */

const HANDLED_TYPES = [
  'customer.email_verification_requested',
  'customer.password_reset_requested',
] as const;
type HandledType = (typeof HANDLED_TYPES)[number];

/**
 * Backoff for a transient failure, indexed by `attempts` *after* increment
 * (so the first retry waits 30s, the second 2m, and so on). Capped at 30
 * minutes — comfortably inside the 1-hour password-reset token TTL
 * (`PASSWORD_RESET_TTL_MS` in `token.service.ts`), the tighter of the two
 * windows this dispatcher serves, so even a message that needed every retry
 * still has a valid link by the time it finally sends. `MAX_ATTEMPTS` being
 * this array's length means the last transient failure recorded still goes
 * back to `PENDING` for one more try; the attempt *after* that is what
 * finally gives up (see `processOne`).
 */
const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

/** How many events one dispatch invocation claims at most — bounded so a
 * single cron tick (or a manually triggered dispatch) cannot run
 * unboundedly long. A backlog larger than this drains over several
 * invocations, which the cron schedule's own cadence already provides for. */
const BATCH_SIZE = 25;

/**
 * How long a `SENDING` claim is honoured before another worker may take the
 * row back (P14).
 *
 * The claim below is atomic, which stops *two live workers* sending the same
 * message — but it says nothing about a worker that stops being live. This
 * dispatcher runs inside a serverless function invocation, where being
 * killed mid-flight is ordinary rather than exotic: the platform's execution
 * limit elapses, a deploy replaces the running instance, the process runs
 * out of memory. Before P14, a row claimed by such a worker stayed `SENDING`
 * for good — the claim query only ever looked at `PENDING`, so nothing
 * would pick it up again, and a customer's verification or reset link was
 * simply never sent, with no error anywhere to say so.
 *
 * So a claim is a lease, not a lock: claiming stamps `nextAttemptAt` this
 * far into the future, and `reclaimExpiredClaims` below hands back anything
 * still `SENDING` past its stamp. Five minutes is comfortably longer than
 * any single send (and than the longest function timeout this project could
 * be deployed under), so a live worker is never robbed of a row it is
 * genuinely working on.
 *
 * The cost, stated plainly: a worker that died *after* the provider
 * accepted the message but before recording `SENT` will send it again, so
 * delivery is at-least-once rather than exactly-once. That is the right way
 * round for these two messages — a customer receiving a second verification
 * link is a minor annoyance; a customer receiving none is an account they
 * cannot use.
 */
const CLAIM_LEASE_MS = 5 * 60_000;

export interface DispatchSummary {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  /** Rows taken back from a worker that never finished (see
   * `CLAIM_LEASE_MS`). Non-zero here means something is killing the
   * dispatcher mid-send and is worth looking at, so it is reported rather
   * than folded silently into `retried`. */
  reclaimed: number;
}

function isHandledType(type: string): type is HandledType {
  return (HANDLED_TYPES as readonly string[]).includes(type);
}

/**
 * The one public entry point. Never throws for a single event's failure —
 * every outcome (sent, retried, or given up on) is recorded on that event's
 * own row and reflected in the returned counts, so one bad message can
 * never take the rest of the batch down with it.
 */
export async function dispatchPendingEmailEvents(): Promise<DispatchSummary> {
  const summary: DispatchSummary = { claimed: 0, sent: 0, retried: 0, failed: 0, reclaimed: 0 };

  // First, before anything else claims: hand back rows whose worker never
  // came back. A reclaimed row returns to `PENDING` with its own backoff, so
  // it is picked up by a later tick rather than immediately below.
  summary.reclaimed = await reclaimExpiredClaims();

  const candidates = await db.outboxEvent.findMany({
    where: {
      status: 'PENDING',
      nextAttemptAt: { lte: new Date() },
      type: { in: [...HANDLED_TYPES] },
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: BATCH_SIZE,
    select: { id: true },
  });

  for (const { id } of candidates) {
    const outcome = await processOne(id);
    // `null` means another worker already claimed this row between the
    // `findMany` above and this row's own claim attempt — not this
    // invocation's work, so it does not count toward `claimed`.
    if (!outcome) continue;
    summary.claimed += 1;
    summary[outcome] += 1;
  }
  return summary;
}

/**
 * Rows still `SENDING` past their lease (see `CLAIM_LEASE_MS`) — a worker
 * that was killed between claiming and recording an outcome.
 *
 * A reclaim costs the message an attempt, exactly as a transient failure
 * does. That is what stops a message whose send reliably kills the worker
 * (a payload that hangs the SMTP conversation until the function times out,
 * say) from being reclaimed and re-hanging the dispatcher forever: it
 * exhausts `MAX_ATTEMPTS` and lands in `FAILED` like any other message that
 * cannot be delivered.
 *
 * Each hand-back is conditioned on the row still being `SENDING` and still
 * past its lease, so of two dispatchers sweeping at once only one can move
 * a given row — the same atomic-claim property `processOne` relies on.
 */
async function reclaimExpiredClaims(): Promise<number> {
  const now = new Date();
  const expired = await db.outboxEvent.findMany({
    where: {
      status: 'SENDING',
      nextAttemptAt: { lte: now },
      type: { in: [...HANDLED_TYPES] },
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: BATCH_SIZE,
    select: { id: true, attempts: true },
  });

  let reclaimed = 0;
  for (const row of expired) {
    const attempts = row.attempts + 1;
    const lastError = 'email-dispatcher: claim expired before the send completed';
    const giveUp = attempts >= MAX_ATTEMPTS;
    const result = await db.outboxEvent.updateMany({
      where: { id: row.id, status: 'SENDING', nextAttemptAt: { lte: now } },
      data: giveUp
        ? { status: 'FAILED', attempts, lastError }
        : {
            status: 'PENDING',
            attempts,
            lastError,
            nextAttemptAt: new Date(now.getTime() + RETRY_DELAYS_MS[attempts - 1]!),
          },
    });
    reclaimed += result.count;
  }
  return reclaimed;
}

/**
 * One event, start to finish: atomic claim, send, then exactly one final
 * transition. The claim (`PENDING` -> `SENDING`) is a single `updateMany`
 * conditioned on the row still being `PENDING` — of two concurrent workers
 * racing the same row, only one can flip that condition, so only one ever
 * proceeds to send (P13 §6/§14's idempotency and concurrency requirements).
 * Every later transition is conditioned on the row still being `SENDING`
 * for the same reason: a worker holding a stale reference to an
 * already-resolved row (someone else's retry beat it, or it was somehow
 * processed twice) matches nothing and silently no-ops rather than
 * reverting a newer state.
 */
async function processOne(id: string): Promise<'sent' | 'retried' | 'failed' | null> {
  const claim = await db.outboxEvent.updateMany({
    where: { id, status: 'PENDING' },
    // `nextAttemptAt` doubles as the claim's lease expiry while the row is
    // `SENDING` (P14 — see `CLAIM_LEASE_MS`). Without stamping it here, the
    // row would keep the already-past value that made it a candidate and
    // `reclaimExpiredClaims` would take it back on the very next tick, while
    // this worker is still genuinely sending it.
    data: { status: 'SENDING', nextAttemptAt: new Date(Date.now() + CLAIM_LEASE_MS) },
  });
  if (claim.count === 0) return null;

  const event = await db.outboxEvent.findUniqueOrThrow({ where: { id } });

  try {
    await sendForEvent(event.type, event.payload);
    await db.outboxEvent.updateMany({
      where: { id, status: 'SENDING' },
      data: { status: 'SENT', sentAt: new Date() },
    });
    return 'sent';
  } catch (error) {
    const kind = isEmailSendError(error) ? error.kind : 'transient';
    // Sanitized deliberately (P13 §12/§13): a message, never the error's
    // full `cause` chain, which for the smtp adapter can carry the SMTP
    // server's own reply text — potentially including the address or
    // content that failed. `Error#message` here is always one of this
    // codebase's own literal strings (see `provider.ts`'s adapters), never
    // provider-supplied text.
    const lastError = error instanceof Error ? error.message : 'unknown error';
    const attempts = event.attempts + 1;

    if (kind === 'permanent' || attempts >= MAX_ATTEMPTS) {
      await db.outboxEvent.updateMany({
        where: { id, status: 'SENDING' },
        data: { status: 'FAILED', attempts, lastError },
      });
      return 'failed';
    }

    const delay = RETRY_DELAYS_MS[attempts - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
    await db.outboxEvent.updateMany({
      where: { id, status: 'SENDING' },
      data: { status: 'PENDING', attempts, lastError, nextAttemptAt: new Date(Date.now() + delay) },
    });
    return 'retried';
  }
}

function localeFor(prismaLocale: 'AR' | 'EN'): Locale {
  return prismaLocale === 'AR' ? 'ar' : 'en';
}

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

function siteOrigin(): string {
  // The one configured, canonical origin (P13 §4) — never the request's own
  // `Host` header, which this dispatcher does not even have access to: it
  // runs from a cron-triggered route handler, not from a page render, and
  // even where a `Request` were available, trusting its `Host` for a
  // security-sensitive link is exactly the open-redirect-adjacent mistake
  // this requirement rules out.
  return clientEnv().NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '');
}

async function sendForEvent(type: string, payload: unknown): Promise<void> {
  if (!isHandledType(type)) {
    // Unreachable via the claim query's own `type: { in: HANDLED_TYPES }`
    // filter — guarded so a future change to that filter fails loudly
    // instead of silently mis-sending.
    throw new Error(`email-dispatcher: unhandled outbox event type "${type}"`);
  }

  const userId =
    typeof payload === 'object' && payload !== null && 'userId' in payload
      ? (payload as { userId: unknown }).userId
      : null;
  if (typeof userId !== 'string' || !userId) {
    // A malformed payload cannot be retried into a valid one — permanent.
    throw new EmailSendError('permanent', 'email-dispatcher: outbox payload missing userId');
  }

  const user = await getUserById(userId);
  if (!user) {
    // The account was deleted between queueing and dispatch — retrying
    // cannot make it reappear.
    throw new EmailSendError('permanent', 'email-dispatcher: user no longer exists');
  }

  const locale = localeFor(user.locale);
  const t = getDictionary(locale).email;
  const greeting = user.name ? interpolate(t.greeting, { name: user.name }) : t.greetingNoName;
  const footer = interpolate(t.footer, { year: String(new Date().getFullYear()) });
  const origin = siteOrigin();

  const provider = getEmailProvider();

  if (type === 'customer.email_verification_requested') {
    const { token } = await createEmailVerificationToken(userId);
    const url = `${origin}/${locale}/account/verify-email?token=${encodeURIComponent(token)}`;
    const copy: EmailCopy = {
      htmlLang: locale,
      dir: locale === 'ar' ? 'rtl' : 'ltr',
      subject: t.verificationSubject,
      heading: t.verificationHeading,
      greeting,
      body: t.verificationBody,
      ctaLabel: t.verificationCta,
      expiryNotice: t.verificationExpiry,
      ignoreNotice: t.verificationIgnore,
      fallbackNotice: t.fallbackNotice,
      footer,
      automatedNotice: t.automatedNotice,
    };
    await provider.send(
      buildVerificationEmail({ to: user.email, toName: user.name, ctaUrl: url, copy }),
    );
    return;
  }

  // customer.password_reset_requested
  const { token } = await createPasswordResetToken(userId);
  const url = `${origin}/${locale}/account/reset-password?token=${encodeURIComponent(token)}`;
  const copy: EmailCopy = {
    htmlLang: locale,
    dir: locale === 'ar' ? 'rtl' : 'ltr',
    subject: t.passwordResetSubject,
    heading: t.passwordResetHeading,
    greeting,
    body: t.passwordResetBody,
    ctaLabel: t.passwordResetCta,
    expiryNotice: t.passwordResetExpiry,
    ignoreNotice: t.passwordResetIgnore,
    fallbackNotice: t.fallbackNotice,
    footer,
    automatedNotice: t.automatedNotice,
  };
  await provider.send(
    buildPasswordResetEmail({ to: user.email, toName: user.name, ctaUrl: url, copy }),
  );
}
