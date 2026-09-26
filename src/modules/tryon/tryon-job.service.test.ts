import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { createCategory, createProduct, publishProduct } from '@/modules/catalog';
import { resetCatalogTables } from '@/modules/catalog/testing';
import { AppError, db } from '@/modules/core';
import { registerCustomer } from '@/modules/customers';
import { resetCustomerTables } from '@/modules/customers/testing';
import { buildSignatureHeader } from '@/modules/payments';

import {
  MOCK_PROCESSING_MS,
  TRYON_SIGNATURE_HEADER,
  createMockTryOnProvider,
} from './mock-provider';
import {
  TryOnProviderError,
  type AITryOnProvider,
  type ProviderJobState,
  type TryOnProviderRequest,
} from './provider';
import { resetTryOnTables } from './testing';
import {
  TRYON_LIMITS,
  applyTryOnCallback,
  cancelTryOnJob,
  createTryOnJob,
  expireTryOnJobs,
  getLatestTryOnJob,
  getTryOnJob,
  retryTryOnJob,
  type TryOnContext,
  type TryOnSubject,
} from './tryon-job.service';

/**
 * The try-on job lifecycle against the real database, on the labelled mock
 * provider — plus, where a provider's *misbehaviour* is the point (a
 * failure, a hostile result URL), a scripted stand-in for the external
 * service that implements the same interface. The job service itself is
 * never mocked.
 */

const SECRET = 'a'.repeat(64);
let now = new Date('2026-09-26T10:00:00.000Z');
const clock = () => now;
const later = (ms: number) => {
  now = new Date(now.getTime() + ms);
};

function mockContext(): TryOnContext {
  return {
    provider: createMockTryOnProvider({ callbackSecret: SECRET, clock }),
    resultHosts: ['results.example-cdn.test'],
    now: clock,
  };
}

/** An external provider that answers what each test scripts. */
function scriptedProvider(script: {
  create?: (request: TryOnProviderRequest) => ProviderJobState | Error;
  get?: (id: string) => ProviderJobState | null;
}): AITryOnProvider & { cancelled: string[]; requests: TryOnProviderRequest[] } {
  const cancelled: string[] = [];
  const requests: TryOnProviderRequest[] = [];
  return {
    name: 'mock',
    isMock: false,
    requiresCustomerPhoto: false,
    cancelled,
    requests,
    async createJob(request) {
      requests.push(request);
      const answer = script.create?.(request) ?? {
        providerJobId: `ext-${request.jobId}`,
        status: 'processing',
        resultUrl: null,
        errorCode: null,
      };
      if (answer instanceof Error) throw answer;
      return answer;
    },
    async getJob(id) {
      return script.get?.(id) ?? null;
    },
    async cancelJob(id) {
      cancelled.push(id);
    },
    verifyCallback: () => ({ ok: false, reason: 'bad_signature' }),
  };
}

let seq = 0;
async function customer(): Promise<string> {
  seq += 1;
  const { customer: c } = await registerCustomer({
    email: `tryon-${seq}-${Date.now()}@example.com`,
    password: 'correct-horse-9',
    name: 'Shopper',
  });
  return c.id;
}

async function product(): Promise<{ productId: string; variants: string[] }> {
  seq += 1;
  const category = await createCategory({
    slug: `tryon-cat-${seq}`,
    nameAr: 'فئة',
    nameEn: `Try-on ${seq}`,
  });
  const created = await createProduct({
    product: {
      slug: `tryon-tee-${seq}`,
      nameAr: 'تيشيرت',
      nameEn: 'Tee',
      categoryId: category.id,
    },
    options: [
      {
        nameAr: 'المقاس',
        nameEn: 'Size',
        values: [
          { valueAr: 'M', valueEn: 'M' },
          { valueAr: 'L', valueEn: 'L' },
        ],
      },
    ],
    variants: ['M', 'L'].map((s, i) => ({
      sku: `tryon-${seq}-${s}`,
      priceMinor: 20_000,
      stockQuantity: 3,
      position: i,
      optionValues: [{ optionNameEn: 'Size', valueEn: s }],
    })),
  });
  await publishProduct(created.id);
  const variants = await db.variant.findMany({
    where: { productId: created.id },
    orderBy: { position: 'asc' },
  });
  return { productId: created.id, variants: variants.map((v) => v.id) };
}

function subject(
  p: { productId: string; variants: string[] },
  index = 0,
  profileVersion = 'v1',
): TryOnSubject {
  return {
    productId: p.productId,
    variantId: p.variants[index]!,
    profileVersion,
    garment: {
      productId: p.productId,
      variantId: p.variants[index]!,
      garmentType: 'T_SHIRT',
      name: { ar: 'تيشيرت', en: 'Tee' },
      sizeLabel: { ar: 'M', en: 'M' },
      colorHex: null,
      imageUrl: null,
    },
    body: {
      gender: 'MALE',
      heightCm: 177,
      weightKg: 78,
      waistCm: 84,
      chestCm: 97,
      hipCm: null,
      shoulderCm: 45,
      inseamCm: null,
    },
  };
}

const start = (
  customerId: string,
  s: TryOnSubject,
  context: TryOnContext,
  idempotencyKey = randomUUID(),
) => createTryOnJob(customerId, s, { idempotencyKey, consentedAt: now }, context);

function reasonOf(error: unknown): string | undefined {
  return error instanceof AppError
    ? (error.details as { reasonCode?: string } | undefined)?.reasonCode
    : undefined;
}

beforeEach(async () => {
  now = new Date('2026-09-26T10:00:00.000Z');
  await resetTryOnTables();
  await resetCatalogTables();
  await resetCustomerTables();
});

describe('the job lifecycle on the mock provider', () => {
  it('starts processing, then completes — without an image, labelled as mock', async () => {
    const context = mockContext();
    const me = await customer();
    const p = await product();

    const job = await start(me, subject(p), context);
    expect(job).toMatchObject({ status: 'PROCESSING', isMock: true, canCancel: true });

    later(MOCK_PROCESSING_MS);
    const done = await getTryOnJob(me, job.id, context);
    expect(done).toMatchObject({ status: 'COMPLETED', isMock: true, resultUrl: null });

    const row = await db.tryOnJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.attempts).toBe(1);
    expect(row.consentedAt.toISOString()).toBe('2026-09-26T10:00:00.000Z');
    // Nothing about the body is stored on the job.
    expect(row).not.toHaveProperty('chestCm');
    expect(row).not.toHaveProperty('heightCm');
  });

  it('asks the provider at most once per poll interval', async () => {
    let asked = 0;
    const provider = scriptedProvider({
      get: (id) => {
        asked += 1;
        return { providerJobId: id, status: 'processing', resultUrl: null, errorCode: null };
      },
    });
    const context = { provider, resultHosts: [], now: clock };
    const me = await customer();
    const job = await start(me, subject(await product()), context);

    await getTryOnJob(me, job.id, context);
    await getTryOnJob(me, job.id, context);
    await getTryOnJob(me, job.id, context);
    expect(asked).toBe(1);
    later(TRYON_LIMITS.pollIntervalMs);
    await getTryOnJob(me, job.id, context);
    expect(asked).toBe(2);
  });

  it('the newest job for a product is there to resume', async () => {
    const context = mockContext();
    const me = await customer();
    const p = await product();
    const job = await start(me, subject(p), context);
    expect(await getLatestTryOnJob(me, p.productId, context)).toMatchObject({ id: job.id });
    expect(await getLatestTryOnJob(await customer(), p.productId, context)).toBeNull();
  });
});

describe('idempotency and duplicates', () => {
  it('the same key returns the same job, and the provider is asked once', async () => {
    const provider = scriptedProvider({});
    const context = { provider, resultHosts: [], now: clock };
    const me = await customer();
    const s = subject(await product());
    const key = randomUUID();
    const a = await start(me, s, context, key);
    const b = await start(me, s, context, key);
    expect(b.id).toBe(a.id);
    expect(provider.requests).toHaveLength(1);
  });

  it('the same key for a different request is refused', async () => {
    const context = mockContext();
    const me = await customer();
    const p = await product();
    const key = randomUUID();
    await start(me, subject(p, 0), context, key);
    const error = await start(me, subject(p, 1), context, key).catch((e: unknown) => e);
    expect(reasonOf(error)).toBe('tryon_idempotency_key_reused');
  });

  it('an unfinished job for the same variant is returned instead of a second one', async () => {
    const context = mockContext();
    const me = await customer();
    const p = await product();
    const a = await start(me, subject(p), context);
    const b = await start(me, subject(p), context);
    expect(b.id).toBe(a.id);
    expect(await db.tryOnJob.count({ where: { customerId: me } })).toBe(1);
    // Another variant is another job.
    const c = await start(me, subject(p, 1), context);
    expect(c.id).not.toBe(a.id);
  });

  it('two customers with the same key get their own jobs', async () => {
    const context = mockContext();
    const p = await product();
    const key = randomUUID();
    const a = await start(await customer(), subject(p), context, key);
    const b = await start(await customer(), subject(p), context, key);
    expect(a.id).not.toBe(b.id);
  });
});

describe('limits', () => {
  it('refuses more than the hourly limit of new jobs per customer', async () => {
    const provider = scriptedProvider({
      create: (r) => ({
        providerJobId: `x-${r.jobId}`,
        status: 'failed',
        resultUrl: null,
        errorCode: 'refused',
      }),
    });
    const context = { provider, resultHosts: [], now: clock };
    const me = await customer();
    const p = await product();
    for (let i = 0; i < TRYON_LIMITS.jobsPerHour; i += 1) await start(me, subject(p), context);
    const error = await start(me, subject(p), context).catch((e: unknown) => e);
    expect(reasonOf(error)).toBe('tryon_rate_limited');
    // Someone else is not affected, and an hour later neither is this customer.
    await expect(start(await customer(), subject(p), context)).resolves.toBeTruthy();
    later(60 * 60 * 1000 + 1);
    await expect(start(me, subject(p), context)).resolves.toBeTruthy();
  });

  it('retries a failed job up to the attempt limit, and no further', async () => {
    const provider = scriptedProvider({
      create: () => new TryOnProviderError('upstream_timeout', true),
    });
    const context = { provider, resultHosts: [], now: clock };
    const me = await customer();
    const s = subject(await product());
    let job = await start(me, s, context);
    expect(job).toMatchObject({ status: 'FAILED', errorCode: 'upstream_timeout', canRetry: true });
    for (let attempt = 2; attempt <= TRYON_LIMITS.maxAttempts; attempt += 1) {
      job = (await retryTryOnJob(me, job.id, s, context))!;
      expect(job.status).toBe('FAILED');
    }
    expect(job.canRetry).toBe(false);
    const error = await retryTryOnJob(me, job.id, s, context).catch((e: unknown) => e);
    expect(reasonOf(error)).toBe('tryon_not_retryable');
    expect(provider.requests).toHaveLength(TRYON_LIMITS.maxAttempts);
  });

  it('a provider that never finishes is given up on after the processing timeout', async () => {
    const provider = scriptedProvider({ get: () => null });
    const context = { provider, resultHosts: [], now: clock };
    const me = await customer();
    const job = await start(me, subject(await product()), context);
    later(TRYON_LIMITS.processingTimeoutMs);
    expect(await getTryOnJob(me, job.id, context)).toMatchObject({
      status: 'FAILED',
      errorCode: 'timed_out',
    });
  });

  it('expires jobs past retention and drops their results', async () => {
    const provider = scriptedProvider({
      create: (r) => ({
        providerJobId: `x-${r.jobId}`,
        status: 'completed',
        resultUrl: 'https://results.example-cdn.test/a.png',
        errorCode: null,
      }),
    });
    const context = { provider, resultHosts: ['results.example-cdn.test'], now: clock };
    const me = await customer();
    const job = await start(me, subject(await product()), context);
    expect(job).toMatchObject({
      status: 'COMPLETED',
      resultUrl: 'https://results.example-cdn.test/a.png',
    });

    later(TRYON_LIMITS.retentionMs);
    expect(await getTryOnJob(me, job.id, context)).toMatchObject({
      status: 'EXPIRED',
      resultUrl: null,
    });
    const row = await db.tryOnJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.resultUrl).toBeNull();
  });

  it('the bulk clean-up expires only what is due', async () => {
    const context = mockContext();
    const me = await customer();
    const p = await product();
    await start(me, subject(p, 0), context);
    later(TRYON_LIMITS.retentionMs / 2);
    await start(me, subject(p, 1), context);
    later(TRYON_LIMITS.retentionMs / 2);
    expect(await expireTryOnJobs(now)).toBe(1);
  });
});

describe('what the service accepts from a provider', () => {
  it.each([
    ['plain http', 'http://results.example-cdn.test/a.png'],
    ['javascript', 'javascript:alert(1)'],
    ['a data URI', 'data:image/png;base64,AAAA'],
    ['another host', 'https://attacker.example/a.png'],
    ['a look-alike host', 'https://results.example-cdn.test.attacker.example/a.png'],
    ['credentials', 'https://user:pass@results.example-cdn.test/a.png'],
  ])('refuses a result URL with %s', async (_label, resultUrl) => {
    const provider = scriptedProvider({
      create: (r) => ({
        providerJobId: `x-${r.jobId}`,
        status: 'completed',
        resultUrl,
        errorCode: null,
      }),
    });
    const context = { provider, resultHosts: ['results.example-cdn.test'], now: clock };
    const job = await start(await customer(), subject(await product()), context);
    expect(job).toMatchObject({
      status: 'FAILED',
      errorCode: 'unsafe_result_url',
      resultUrl: null,
    });
    const row = await db.tryOnJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.resultUrl).toBeNull();
  });

  it('a real provider finishing with no result is a failure, not an empty success', async () => {
    const provider = scriptedProvider({
      create: (r) => ({
        providerJobId: `x-${r.jobId}`,
        status: 'completed',
        resultUrl: null,
        errorCode: null,
      }),
    });
    const job = await start(await customer(), subject(await product()), {
      provider,
      resultHosts: [],
      now: clock,
    });
    expect(job).toMatchObject({ status: 'FAILED', errorCode: 'missing_result' });
  });

  it('sends the provider the server-built description, and no account data', async () => {
    const provider = scriptedProvider({});
    const me = await customer();
    const s = subject(await product());
    const job = await start(me, s, { provider, resultHosts: [], now: clock });
    expect(provider.requests).toEqual([{ jobId: job.id, garment: s.garment, body: s.body }]);
    expect(JSON.stringify(provider.requests)).not.toContain(me);
  });
});

describe('customer isolation', () => {
  it('another customer cannot read, cancel or retry a job — it does not exist for them', async () => {
    const context = mockContext();
    const owner = await customer();
    const other = await customer();
    const s = subject(await product());
    const job = await start(owner, s, context);

    expect(await getTryOnJob(other, job.id, context)).toBeNull();
    expect(await cancelTryOnJob(other, job.id, context)).toBeNull();
    expect(await retryTryOnJob(other, job.id, s, context)).toBeNull();
    // Untouched.
    expect(await getTryOnJob(owner, job.id, context)).toMatchObject({ status: 'PROCESSING' });
  });

  it('a malformed job id finds nothing rather than erroring', async () => {
    const context = mockContext();
    expect(await getTryOnJob(await customer(), "1' OR '1'='1", context)).toBeNull();
  });
});

describe('cancelling', () => {
  it('cancels an unfinished job at the provider and here; a finished one cannot be', async () => {
    const provider = scriptedProvider({});
    const context = { provider, resultHosts: [], now: clock };
    const me = await customer();
    const job = await start(me, subject(await product()), context);
    const cancelled = await cancelTryOnJob(me, job.id, context);
    expect(cancelled).toMatchObject({ status: 'CANCELLED', canCancel: false, canRetry: false });
    expect(provider.cancelled).toEqual([`ext-${job.id}`]);

    const error = await cancelTryOnJob(me, job.id, context).catch((e: unknown) => e);
    expect(reasonOf(error)).toBe('tryon_not_cancellable');
  });

  it('a result arriving after a cancel is not applied', async () => {
    const provider = scriptedProvider({
      get: (id) => ({ providerJobId: id, status: 'completed', resultUrl: null, errorCode: null }),
    });
    const context = { provider, resultHosts: [], now: clock };
    const me = await customer();
    const job = await start(me, subject(await product()), context);
    await cancelTryOnJob(me, job.id, context);
    later(TRYON_LIMITS.pollIntervalMs);
    expect(await getTryOnJob(me, job.id, context)).toMatchObject({ status: 'CANCELLED' });
  });
});

describe('provider callbacks', () => {
  async function processingJob() {
    const context = mockContext();
    const me = await customer();
    const job = await start(me, subject(await product()), context);
    const row = await db.tryOnJob.findUniqueOrThrow({ where: { id: job.id } });
    return { context, me, job, providerJobId: row.providerJobId! };
  }

  function deliver(context: TryOnContext, body: Record<string, unknown>, at = now) {
    const raw = JSON.stringify(body);
    const headers = new Headers({
      [TRYON_SIGNATURE_HEADER]: buildSignatureHeader(SECRET, raw, at),
    });
    return context.provider.verifyCallback(raw, headers);
  }

  it('a verified callback finishes the job; replaying it changes nothing', async () => {
    const { context, me, job, providerJobId } = await processingJob();
    const body = {
      eventId: 'evt-1',
      providerJobId,
      status: 'failed',
      resultUrl: null,
      errorCode: 'garment_unreadable',
      occurredAt: now.toISOString(),
    };
    const verified = deliver(context, body);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(await applyTryOnCallback(verified.callback, context)).toBe('applied');
    expect(await getTryOnJob(me, job.id, context)).toMatchObject({
      status: 'FAILED',
      errorCode: 'garment_unreadable',
    });
    expect(await applyTryOnCallback(verified.callback, context)).toBe('duplicate');
  });

  it('an older callback than one already applied is ignored', async () => {
    const { context, providerJobId } = await processingJob();
    await db.tryOnJob.updateMany({ where: { providerJobId }, data: { lastEventAt: now } });
    const older = deliver(context, {
      eventId: 'evt-old',
      providerJobId,
      status: 'failed',
      resultUrl: null,
      errorCode: 'x',
      occurredAt: new Date(now.getTime() - 1000).toISOString(),
    });
    expect(older.ok && (await applyTryOnCallback(older.callback, context))).toBe('stale');
  });

  it('a callback with a hostile result URL fails the job instead of storing it', async () => {
    const { context, me, job, providerJobId } = await processingJob();
    const verified = deliver(context, {
      eventId: 'evt-2',
      providerJobId,
      status: 'completed',
      resultUrl: 'javascript:alert(document.cookie)',
      errorCode: null,
      occurredAt: now.toISOString(),
    });
    expect(verified.ok && (await applyTryOnCallback(verified.callback, context))).toBe('applied');
    expect(await getTryOnJob(me, job.id, context)).toMatchObject({
      status: 'FAILED',
      errorCode: 'unsafe_result_url',
      resultUrl: null,
    });
  });

  it('a callback for a job this provider never had is reported, not applied', async () => {
    const context = mockContext();
    const verified = deliver(context, {
      eventId: 'evt-3',
      providerJobId: 'mock_zzz_0000000000000000',
      status: 'completed',
      resultUrl: null,
      errorCode: null,
      occurredAt: now.toISOString(),
    });
    expect(verified.ok && (await applyTryOnCallback(verified.callback, context))).toBe(
      'unknown_job',
    );
  });
});
