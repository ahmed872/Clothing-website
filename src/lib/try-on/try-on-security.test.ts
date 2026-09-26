import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { saveBodyProfile } from '@/modules/body-profile';
import { resetBodyProfileTables } from '@/modules/body-profile/testing';
import { createCategory, createProduct, publishProduct } from '@/modules/catalog';
import { resetCatalogTables } from '@/modules/catalog/testing';
import { db } from '@/modules/core';
import { registerCustomer } from '@/modules/customers';
import { resetCustomerTables } from '@/modules/customers/testing';
import { buildSignatureHeader } from '@/modules/payments';
import { saveProductSizing } from '@/modules/sizing';
import { resetSizingTables } from '@/modules/sizing/testing';
import { resetTryOnTables } from '@/modules/tryon/testing';

/**
 * AI try-on as a customer (or an attacker, or a provider) reaches it: the
 * real actions, routes, job service and database. Two seams are replaced —
 * the customer session (`customerAuth`, as every account test here does)
 * and the provider *selection*, so the same file covers "switched off" and
 * "mock on" regardless of the local `.env.test`. The provider selected is
 * the real mock adapter, with the real HMAC callback check.
 */

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/identity/customer-auth', () => ({ customerAuth: authMock }));

const configMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/tryon/provider-factory', () => ({
  getTryOnConfig: configMock,
  isTryOnEnabled: () => configMock() !== null,
  resetTryOnConfigCache: () => undefined,
}));

const { createMockTryOnProvider, TRYON_SIGNATURE_HEADER } = await import('@/modules/tryon');
const { startTryOnAction, cancelTryOnAction, retryTryOnAction } = await import('./try-on-actions');
const { GET: getJobRoute } = await import('@/app/api/try-on/jobs/[id]/route');
const { POST: callbackRoute } = await import('@/app/api/try-on/callback/[provider]/route');

const SECRET = 'd'.repeat(64);
const swatch = (digits: string) => `#${digits}`;

function enableMock(processingMs?: number): void {
  configMock.mockReturnValue({
    provider: createMockTryOnProvider({ callbackSecret: SECRET, processingMs }),
    resultHosts: ['results.example-cdn.test'],
  });
}

function signInAs(userId: string | null): void {
  authMock.mockResolvedValue(
    userId
      ? {
          user: { id: userId, email: `${userId}@example.com`, name: null, role: 'CUSTOMER' },
          expires: '2099-01-01T00:00:00.000Z',
        }
      : null,
  );
}

let seq = 0;
async function shopper({ profile = true } = {}) {
  seq += 1;
  const { user, customer } = await registerCustomer({
    email: `tryon-sec-${seq}-${Date.now()}@example.com`,
    password: 'correct-horse-9',
    name: 'Shopper',
  });
  if (profile) {
    await saveBodyProfile(customer.id, {
      gender: 'FEMALE',
      heightCm: '165',
      weightKg: '60',
      waistCm: '70',
      chestCm: '88',
    });
  }
  return { userId: user.id, customerId: customer.id };
}

async function product(slug: string, { publish = true } = {}) {
  const category = await createCategory({
    slug: `cat-${slug}`,
    nameAr: 'فئة',
    nameEn: `Category ${slug}`,
  });
  const sizes = ['S', 'M'];
  const created = await createProduct({
    product: { slug, nameAr: 'تيشيرت', nameEn: 'Tee', categoryId: category.id },
    options: [
      { nameAr: 'اللون', nameEn: 'Color', values: [{ valueAr: 'أسود', valueEn: 'Black' }] },
      { nameAr: 'المقاس', nameEn: 'Size', values: sizes.map((s) => ({ valueAr: s, valueEn: s })) },
    ],
    variants: sizes.map((s, i) => ({
      sku: `${slug}-${s}`,
      priceMinor: 20_000,
      stockQuantity: 4,
      position: i,
      optionValues: [
        { optionNameEn: 'Color', valueEn: 'Black' },
        { optionNameEn: 'Size', valueEn: s },
      ],
    })),
  });
  if (publish) await publishProduct(created.id);
  const options = await db.productOption.findMany({
    where: { productId: created.id },
    include: { values: { orderBy: { position: 'asc' } } },
  });
  const size = options.find((o) => o.nameEn === 'Size')!;
  const color = options.find((o) => o.nameEn === 'Color')!;
  await saveProductSizing(created.id, {
    garmentType: 'T_SHIRT',
    sizeOptionId: size.id,
    entries: size.values.map((v, i) => ({
      optionValueId: v.id,
      measurements: { chestCm: String(92 + i * 6) },
    })),
    colorOptionId: color.id,
    swatches: [{ optionValueId: color.values[0]!.id, hex: swatch('1D1D20') }],
  });
  const variants = await db.variant.findMany({
    where: { productId: created.id },
    orderBy: { position: 'asc' },
  });
  return { id: created.id, slug, variants: variants.map((v) => v.id) };
}

const startInput = (slug: string, variantId: string, extra: Record<string, unknown> = {}) => ({
  slug,
  variantId,
  idempotencyKey: randomUUID(),
  consent: true,
  ...extra,
});

const jobRequest = (id: string) =>
  getJobRoute(new Request(`http://localhost/api/try-on/jobs/${id}`), {
    params: Promise.resolve({ id }),
  });

beforeEach(async () => {
  await resetTryOnTables();
  await resetSizingTables();
  await resetBodyProfileTables();
  await resetCatalogTables();
  await resetCustomerTables();
  authMock.mockReset();
  configMock.mockReset();
  enableMock();
});

describe('starting a try-on', () => {
  it('builds the job for the session’s customer from server data', async () => {
    const me = await shopper();
    const p = await product('tee-start');
    signInAs(me.userId);
    const result = await startTryOnAction(startInput(p.slug, p.variants[1]!));
    expect(result).toMatchObject({ ok: true, job: { status: 'PROCESSING', isMock: true } });
    const rows = await db.tryOnJob.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      customerId: me.customerId,
      productId: p.id,
      variantId: p.variants[1],
      provider: 'mock',
    });
  });

  it('is refused when signed out', async () => {
    const p = await product('tee-anon');
    signInAs(null);
    expect(await startTryOnAction(startInput(p.slug, p.variants[0]!))).toEqual({
      ok: false,
      error: 'session_expired',
    });
    expect(await db.tryOnJob.count()).toBe(0);
  });

  it('says it is unavailable when no provider is configured — and creates nothing', async () => {
    configMock.mockReturnValue(null);
    const me = await shopper();
    const p = await product('tee-off');
    signInAs(me.userId);
    expect(await startTryOnAction(startInput(p.slug, p.variants[0]!))).toEqual({
      ok: false,
      error: 'unavailable',
    });
    expect(await db.tryOnJob.count()).toBe(0);
  });

  it('needs consent for every job', async () => {
    const me = await shopper();
    const p = await product('tee-consent');
    signInAs(me.userId);
    expect(await startTryOnAction(startInput(p.slug, p.variants[0]!, { consent: false }))).toEqual({
      ok: false,
      error: 'consent_required',
    });
    expect(
      await startTryOnAction({ ...startInput(p.slug, p.variants[0]!), consent: 'yes' }),
    ).toEqual({ ok: false, error: 'invalid' });
    expect(await db.tryOnJob.count()).toBe(0);
  });

  it.each([
    ['a customer id', { customerId: randomUUID() }],
    ['a body profile id', { bodyProfileId: randomUUID() }],
    ['a photo', { photo: 'data:image/jpeg;base64,/9j/4AAQ' }],
    ['a price', { priceMinor: 1 }],
    ['a size', { size: 'XL' }],
    ['a result URL', { resultUrl: 'https://attacker.example/x.png' }],
  ])('refuses a request carrying %s', async (_label, extra) => {
    const me = await shopper();
    const p = await product(`tee-extra-${seq}`);
    signInAs(me.userId);
    expect(await startTryOnAction(startInput(p.slug, p.variants[0]!, extra))).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(await db.tryOnJob.count()).toBe(0);
  });

  it('refuses oversized or malformed inputs', async () => {
    const me = await shopper();
    const p = await product('tee-size');
    signInAs(me.userId);
    for (const input of [
      startInput('x'.repeat(10_000), p.variants[0]!),
      startInput(p.slug, 'not-a-uuid'),
      { ...startInput(p.slug, p.variants[0]!), idempotencyKey: 'k'.repeat(5_000) },
      'a string',
      null,
    ]) {
      expect(await startTryOnAction(input)).toEqual({ ok: false, error: 'invalid' });
    }
  });

  it('refuses a variant of another product, a draft product, and a customer without a profile', async () => {
    const me = await shopper();
    const a = await product('tee-a');
    const b = await product('tee-b');
    const draft = await product('tee-draft', { publish: false });
    signInAs(me.userId);
    expect(await startTryOnAction(startInput(a.slug, b.variants[0]!))).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await startTryOnAction(startInput(draft.slug, draft.variants[0]!))).toEqual({
      ok: false,
      error: 'not_found',
    });
    const noProfile = await shopper({ profile: false });
    signInAs(noProfile.userId);
    expect(await startTryOnAction(startInput(a.slug, a.variants[0]!))).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await db.tryOnJob.count()).toBe(0);
  });

  it('a double submit with one key makes one job', async () => {
    const me = await shopper();
    const p = await product('tee-double');
    signInAs(me.userId);
    const input = startInput(p.slug, p.variants[0]!);
    const [a, b] = await Promise.all([startTryOnAction(input), startTryOnAction(input)]);
    expect(a.ok && b.ok && a.job.id === b.job.id).toBe(true);
    expect(await db.tryOnJob.count()).toBe(1);
  });

  it('answers rate_limited past the hourly limit', async () => {
    enableMock(0);
    const me = await shopper();
    const p = await product('tee-limit');
    signInAs(me.userId);
    for (let i = 0; i < 10; i += 1) {
      expect(await startTryOnAction(startInput(p.slug, p.variants[i % 2]!))).toMatchObject({
        ok: true,
      });
    }
    expect(await startTryOnAction(startInput(p.slug, p.variants[0]!))).toEqual({
      ok: false,
      error: 'rate_limited',
    });
  });
});

describe('a job is its owner’s alone', () => {
  async function ownersJob() {
    const owner = await shopper();
    const p = await product(`tee-own-${seq}`);
    signInAs(owner.userId);
    const result = await startTryOnAction(startInput(p.slug, p.variants[0]!));
    if (!result.ok) throw new Error(result.error);
    return { owner, p, job: result.job };
  }

  it('the owner reads it, privately, through the route', async () => {
    const { job } = await ownersJob();
    const response = await jobRequest(job.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ job: { id: job.id, isMock: true } });
  });

  it('another customer gets 404 from the route, and not_found from cancel and retry', async () => {
    const { owner, p, job } = await ownersJob();
    const intruder = await shopper();
    signInAs(intruder.userId);
    const response = await jobRequest(job.id);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(await cancelTryOnAction({ jobId: job.id })).toEqual({ ok: false, error: 'not_found' });
    expect(await retryTryOnAction({ jobId: job.id, slug: p.slug })).toEqual({
      ok: false,
      error: 'not_found',
    });

    signInAs(owner.userId);
    expect(await (await jobRequest(job.id)).json()).toMatchObject({
      job: { status: 'PROCESSING' },
    });
  });

  it('signed out, the route answers 401 and reveals nothing', async () => {
    const { job } = await ownersJob();
    signInAs(null);
    const response = await jobRequest(job.id);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthenticated' });
  });

  it('the owner can cancel it; cancelling twice is not allowed', async () => {
    const { job } = await ownersJob();
    expect(await cancelTryOnAction({ jobId: job.id })).toMatchObject({
      ok: true,
      job: { status: 'CANCELLED' },
    });
    expect(await cancelTryOnAction({ jobId: job.id })).toEqual({ ok: false, error: 'not_allowed' });
    expect(await cancelTryOnAction({ jobId: job.id, customerId: randomUUID() })).toEqual({
      ok: false,
      error: 'invalid',
    });
  });

  it('a retry names the job’s own product, or finds nothing', async () => {
    const { job } = await ownersJob();
    await db.tryOnJob.update({ where: { id: job.id }, data: { status: 'FAILED', errorCode: 'x' } });
    const other = await product('tee-other');
    expect(await retryTryOnAction({ jobId: job.id, slug: other.slug })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});

describe('the provider callback route', () => {
  async function processingJob() {
    const owner = await shopper();
    const p = await product(`tee-cb-${seq}`);
    signInAs(owner.userId);
    const result = await startTryOnAction(startInput(p.slug, p.variants[0]!));
    if (!result.ok) throw new Error(result.error);
    const row = await db.tryOnJob.findUniqueOrThrow({ where: { id: result.job.id } });
    return { owner, job: result.job, providerJobId: row.providerJobId! };
  }

  function post(
    body: string,
    headers: Record<string, string> = {},
    provider = 'mock',
  ): Promise<Response> {
    return callbackRoute(
      new Request(`http://localhost/api/try-on/callback/${provider}`, {
        method: 'POST',
        body,
        headers,
      }),
      { params: Promise.resolve({ provider }) },
    );
  }

  function signedBody(providerJobId: string, at = new Date()) {
    const raw = JSON.stringify({
      eventId: `evt-${randomUUID()}`,
      providerJobId,
      status: 'failed',
      resultUrl: null,
      errorCode: 'garment_unreadable',
      occurredAt: at.toISOString(),
    });
    return { raw, header: buildSignatureHeader(SECRET, raw, at) };
  }

  it('applies a signed callback once; the replay is acknowledged and changes nothing', async () => {
    const { job, providerJobId } = await processingJob();
    const { raw, header } = signedBody(providerJobId);
    const first = await post(raw, { [TRYON_SIGNATURE_HEADER]: header });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true, outcome: 'applied' });
    const replay = await post(raw, { [TRYON_SIGNATURE_HEADER]: header });
    expect(await replay.json()).toEqual({ received: true, outcome: 'duplicate' });
    const row = await db.tryOnJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: 'FAILED', errorCode: 'garment_unreadable' });
  });

  it('refuses unsigned, forged and stale deliveries without saying which', async () => {
    const { job, providerJobId } = await processingJob();
    const { raw } = signedBody(providerJobId);
    const stale = signedBody(providerJobId, new Date(Date.now() - 10 * 60 * 1000));
    for (const response of [
      await post(raw),
      await post(raw, {
        [TRYON_SIGNATURE_HEADER]: buildSignatureHeader('e'.repeat(64), raw, new Date()),
      }),
      await post(stale.raw, { [TRYON_SIGNATURE_HEADER]: stale.header }),
    ]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ received: false });
    }
    expect((await db.tryOnJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'PROCESSING',
    );
  });

  it('refuses oversized bodies, declared or not', async () => {
    const big = 'x'.repeat(20 * 1024);
    expect((await post(big, { 'content-length': String(big.length) })).status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const response = await callbackRoute(
      new Request('http://localhost/api/try-on/callback/mock', {
        method: 'POST',
        body: stream,
        // @ts-expect-error — Node's fetch needs `duplex` for a stream body.
        duplex: 'half',
      }),
      { params: Promise.resolve({ provider: 'mock' }) },
    );
    expect(response.status).toBe(413);
  });

  it('answers 404 for a provider this deployment does not run, or when try-on is off', async () => {
    expect((await post('{}', {}, 'someone-else')).status).toBe(404);
    configMock.mockReturnValue(null);
    expect((await post('{}')).status).toBe(404);
  });
});
