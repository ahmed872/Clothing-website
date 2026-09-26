import { createHash } from 'node:crypto';

import { Prisma, type TryOnJob, type TryOnJobStatus } from '@generated/prisma';

import { AppError, db } from '@/modules/core';

import {
  TryOnProviderError,
  type AITryOnProvider,
  type ProviderJobState,
  type TryOnBody,
  type TryOnGarment,
  type VerifiedTryOnCallback,
} from './provider';
import { isAllowedResultUrl } from './result-url';

/**
 * AI try-on jobs (clothing P05): create, follow, cancel, retry, expire.
 *
 * Every read and write takes the customer id from its caller — who took it
 * from the session — and every query is scoped by it, so one customer's job
 * id in another customer's request finds nothing: the answer is "not found",
 * the same as for an id that never existed, never "forbidden".
 *
 * What the service trusts from a provider: nothing unchecked. States only
 * move forward (a finished job never changes again), an older callback
 * cannot overwrite a newer one, and a result URL is stored only if it passes
 * the operator's host allowlist.
 */

export const TRYON_LIMITS = {
  /** New jobs per customer per rolling hour. Counted in the database, so it
   * holds across server instances. */
  jobsPerHour: 10,
  /** Provider submissions per job, the first included. */
  maxAttempts: 3,
  /** A job the provider has not finished by then is given up on. */
  processingTimeoutMs: 15 * 60 * 1000,
  /** How long a job — and its result — stays visible to the customer. */
  retentionMs: 24 * 60 * 60 * 1000,
  /** At most one provider status check per job per this interval, however
   * often the page polls. */
  pollIntervalMs: 2_000,
} as const;

const ACTIVE: TryOnJobStatus[] = ['PENDING', 'PROCESSING'];
const FINAL: TryOnJobStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a job is built from — assembled by the server from the catalog and
 * the customer's own profile, never taken from the browser. */
export interface TryOnSubject {
  productId: string;
  variantId: string;
  /** Changes whenever the profile does (its `updatedAt`), so a request built
   * from different measurements hashes differently. */
  profileVersion: string;
  garment: TryOnGarment;
  body: TryOnBody;
}

export interface TryOnContext {
  provider: AITryOnProvider;
  resultHosts: readonly string[];
  now?: () => Date;
}

export interface TryOnJobView {
  id: string;
  productId: string;
  variantId: string;
  status: TryOnJobStatus;
  /** The job ran on the mock provider: no AI image exists for it. */
  isMock: boolean;
  resultUrl: string | null;
  errorCode: string | null;
  canCancel: boolean;
  canRetry: boolean;
  createdAt: string;
  expiresAt: string;
}

export type TryOnCallbackOutcome = 'applied' | 'duplicate' | 'stale' | 'unknown_job';

function clock(context: TryOnContext): Date {
  return context.now?.() ?? new Date();
}

export function tryOnRequestHash(subject: TryOnSubject): string {
  return createHash('sha256')
    .update(JSON.stringify([subject.productId, subject.variantId, subject.profileVersion]))
    .digest('hex');
}

export function toTryOnJobView(job: TryOnJob): TryOnJobView {
  return {
    id: job.id,
    productId: job.productId,
    variantId: job.variantId,
    status: job.status,
    isMock: job.provider === 'mock',
    resultUrl: job.status === 'COMPLETED' ? job.resultUrl : null,
    errorCode: job.errorCode,
    canCancel: ACTIVE.includes(job.status),
    canRetry: job.status === 'FAILED' && job.attempts < TRYON_LIMITS.maxAttempts,
    createdAt: job.createdAt.toISOString(),
    expiresAt: job.expiresAt.toISOString(),
  };
}

/** Moves a job on only while it is still active: a conditional update, so
 * two concurrent writers (a poll and a callback) cannot both finish it. */
async function transition(
  job: TryOnJob,
  data: Prisma.TryOnJobUpdateManyMutationInput,
): Promise<TryOnJob> {
  await db.tryOnJob.updateMany({ where: { id: job.id, status: { in: ACTIVE } }, data });
  return db.tryOnJob.findUniqueOrThrow({ where: { id: job.id } });
}

async function applyProviderState(
  job: TryOnJob,
  state: ProviderJobState,
  context: TryOnContext,
  extra: Prisma.TryOnJobUpdateManyMutationInput = {},
): Promise<TryOnJob> {
  const now = clock(context);
  if (state.status === 'processing') {
    return transition(job, { ...extra, status: 'PROCESSING', providerJobId: state.providerJobId });
  }
  if (state.status === 'failed') {
    return transition(job, {
      ...extra,
      status: 'FAILED',
      providerJobId: state.providerJobId,
      errorCode: state.errorCode ?? 'provider_failed',
    });
  }
  // Completed. A result URL, whoever sent it, must pass the allowlist; only
  // the mock may complete without one — it has no image to give, and the
  // job says it ran on the mock.
  if (state.resultUrl === null && !context.provider.isMock) {
    return transition(job, { ...extra, status: 'FAILED', errorCode: 'missing_result' });
  }
  if (state.resultUrl !== null && !isAllowedResultUrl(state.resultUrl, context.resultHosts)) {
    return transition(job, { ...extra, status: 'FAILED', errorCode: 'unsafe_result_url' });
  }
  return transition(job, {
    ...extra,
    status: 'COMPLETED',
    providerJobId: state.providerJobId,
    resultUrl: state.resultUrl,
    errorCode: null,
    completedAt: now,
  });
}

async function submit(
  job: TryOnJob,
  subject: TryOnSubject,
  context: TryOnContext,
): Promise<TryOnJob> {
  await db.tryOnJob.update({ where: { id: job.id }, data: { attempts: { increment: 1 } } });
  const counted = { ...job, attempts: job.attempts + 1 };
  try {
    const state = await context.provider.createJob({
      jobId: job.id,
      garment: subject.garment,
      body: subject.body,
    });
    return await applyProviderState(counted, state, context);
  } catch (error) {
    const code =
      error instanceof TryOnProviderError ? error.code.slice(0, 64) : 'provider_unavailable';
    return transition(counted, { status: 'FAILED', errorCode: code });
  }
}

/** Finishes what time has decided: a job the provider never finished, and
 * anything past its retention (whose result is dropped with it). */
async function settleByTime(job: TryOnJob, now: Date): Promise<TryOnJob> {
  if (job.status !== 'EXPIRED' && job.expiresAt <= now) {
    return db.tryOnJob.update({
      where: { id: job.id },
      data: { status: 'EXPIRED', resultUrl: null },
    });
  }
  if (
    ACTIVE.includes(job.status) &&
    now.getTime() - job.submittedAt.getTime() >= TRYON_LIMITS.processingTimeoutMs
  ) {
    return transition(job, { status: 'FAILED', errorCode: 'timed_out' });
  }
  return job;
}

/**
 * Starts a try-on for the customer — or returns the job that already
 * answers this request:
 *
 * - the same idempotency key again returns that key's job (a double click,
 *   a retried request); the same key with a *different* request is refused;
 * - an unfinished job for the same variant is returned rather than a
 *   second one started.
 */
export async function createTryOnJob(
  customerId: string,
  subject: TryOnSubject,
  options: { idempotencyKey: string; consentedAt: Date },
  context: TryOnContext,
): Promise<TryOnJobView> {
  const now = clock(context);
  const requestHash = tryOnRequestHash(subject);
  const key = { customerId_idempotencyKey: { customerId, idempotencyKey: options.idempotencyKey } };

  const replay = await db.tryOnJob.findUnique({ where: key });
  if (replay) {
    if (replay.requestHash !== requestHash) {
      throw new AppError('CONFLICT', {
        internalMessage: 'A try-on idempotency key was reused for a different request',
        details: { reasonCode: 'tryon_idempotency_key_reused' },
      });
    }
    return toTryOnJobView(await settleByTime(replay, now));
  }

  const running = await db.tryOnJob.findFirst({
    where: {
      customerId,
      variantId: subject.variantId,
      status: { in: ACTIVE },
      submittedAt: { gt: new Date(now.getTime() - TRYON_LIMITS.processingTimeoutMs) },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (running) return toTryOnJobView(running);

  const recent = await db.tryOnJob.count({
    where: { customerId, createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) } },
  });
  if (recent >= TRYON_LIMITS.jobsPerHour) {
    throw new AppError('RATE_LIMITED', {
      internalMessage: 'Try-on hourly limit reached',
      details: { reasonCode: 'tryon_rate_limited' },
    });
  }

  let job: TryOnJob;
  try {
    job = await db.tryOnJob.create({
      data: {
        customerId,
        productId: subject.productId,
        variantId: subject.variantId,
        provider: context.provider.name,
        idempotencyKey: options.idempotencyKey,
        requestHash,
        consentedAt: options.consentedAt,
        createdAt: now,
        submittedAt: now,
        expiresAt: new Date(now.getTime() + TRYON_LIMITS.retentionMs),
      },
    });
  } catch (error) {
    // Two requests with one key raced: the other one created it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await db.tryOnJob.findUnique({ where: key });
      if (winner && winner.requestHash === requestHash) return toTryOnJobView(winner);
    }
    throw error;
  }

  return toTryOnJobView(await submit(job, subject, context));
}

async function ownJob(customerId: string, jobId: string): Promise<TryOnJob | null> {
  if (!UUID.test(jobId)) return null;
  return db.tryOnJob.findFirst({ where: { id: jobId, customerId } });
}

/**
 * The customer's own job, brought up to date: settled by time, and — while
 * the provider is still working on it — refreshed from the provider at most
 * once per poll interval. Null for anyone else's job.
 */
export async function getTryOnJob(
  customerId: string,
  jobId: string,
  context: TryOnContext,
): Promise<TryOnJobView | null> {
  const found = await ownJob(customerId, jobId);
  if (!found) return null;
  const now = clock(context);
  let job = await settleByTime(found, now);

  const due =
    job.lastPolledAt === null ||
    now.getTime() - job.lastPolledAt.getTime() >= TRYON_LIMITS.pollIntervalMs;
  if (
    job.status === 'PROCESSING' &&
    job.providerJobId &&
    job.provider === context.provider.name &&
    due
  ) {
    await db.tryOnJob.update({ where: { id: job.id }, data: { lastPolledAt: now } });
    try {
      const state = await context.provider.getJob(job.providerJobId);
      if (state) job = await applyProviderState(job, state, context);
    } catch {
      // A failed status check changes nothing; the next poll tries again,
      // and the processing timeout ends a job that never answers.
    }
  }
  return toTryOnJobView(job);
}

/** The customer's newest job for a product, for the fitting room to resume. */
export async function getLatestTryOnJob(
  customerId: string,
  productId: string,
  context: TryOnContext,
): Promise<TryOnJobView | null> {
  const latest = await db.tryOnJob.findFirst({
    where: { customerId, productId, status: { not: 'EXPIRED' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return latest ? getTryOnJob(customerId, latest.id, context) : null;
}

export async function cancelTryOnJob(
  customerId: string,
  jobId: string,
  context: TryOnContext,
): Promise<TryOnJobView | null> {
  const found = await ownJob(customerId, jobId);
  if (!found) return null;
  const job = await settleByTime(found, clock(context));
  if (!ACTIVE.includes(job.status)) {
    throw new AppError('INVALID_STATE_TRANSITION', {
      internalMessage: `Cannot cancel a ${job.status} try-on job`,
      details: { reasonCode: 'tryon_not_cancellable' },
    });
  }
  if (job.providerJobId && job.provider === context.provider.name) {
    try {
      await context.provider.cancelJob(job.providerJobId);
    } catch {
      // Cancelled here regardless: whatever the provider still produces is
      // never applied to a cancelled job.
    }
  }
  return toTryOnJobView(await transition(job, { status: 'CANCELLED' }));
}

/** Submits a failed job again, rebuilt from current data, within the
 * attempt limit. */
export async function retryTryOnJob(
  customerId: string,
  jobId: string,
  subject: TryOnSubject,
  context: TryOnContext,
): Promise<TryOnJobView | null> {
  const found = await ownJob(customerId, jobId);
  if (!found) return null;
  const job = await settleByTime(found, clock(context));
  if (job.status !== 'FAILED' || job.attempts >= TRYON_LIMITS.maxAttempts) {
    throw new AppError('INVALID_STATE_TRANSITION', {
      internalMessage: `Cannot retry a ${job.status} try-on job after ${job.attempts} attempts`,
      details: { reasonCode: 'tryon_not_retryable' },
    });
  }
  if (subject.variantId !== job.variantId || job.provider !== context.provider.name) {
    throw new AppError('CONFLICT', {
      internalMessage: 'A try-on retry must be for the same variant and provider',
      details: { reasonCode: 'tryon_not_retryable' },
    });
  }
  const now = clock(context);
  const reset = await db.tryOnJob.update({
    where: { id: job.id },
    data: {
      status: 'PENDING',
      errorCode: null,
      providerJobId: null,
      lastPolledAt: null,
      requestHash: tryOnRequestHash(subject),
      // A retry is a fresh wait for the provider.
      submittedAt: now,
    },
  });
  return toTryOnJobView(await submit(reset, subject, context));
}

/**
 * Applies a verified provider callback. Only moves an active job; a
 * callback older than one already applied is ignored, and a callback for a
 * finished job — a replay, or a late duplicate — changes nothing.
 */
export async function applyTryOnCallback(
  callback: VerifiedTryOnCallback,
  context: TryOnContext,
): Promise<TryOnCallbackOutcome> {
  const job = await db.tryOnJob.findUnique({
    where: {
      provider_providerJobId: {
        provider: context.provider.name,
        providerJobId: callback.state.providerJobId,
      },
    },
  });
  if (!job) return 'unknown_job';
  if (FINAL.includes(job.status)) return 'duplicate';
  if (job.lastEventAt && callback.occurredAt <= job.lastEventAt) return 'stale';
  await applyProviderState(job, callback.state, context, { lastEventAt: callback.occurredAt });
  return 'applied';
}

/** Expires every job past its retention, dropping results with it. For a
 * scheduled clean-up; reads also expire the one job they touch. */
export async function expireTryOnJobs(now: Date = new Date()): Promise<number> {
  const { count } = await db.tryOnJob.updateMany({
    where: { status: { not: 'EXPIRED' }, expiresAt: { lte: now } },
    data: { status: 'EXPIRED', resultUrl: null },
  });
  return count;
}
