import { createHash } from 'node:crypto';

import { z } from 'zod';

import { verifySignedPayload } from '@/modules/payments';

import type {
  AITryOnProvider,
  ProviderJobState,
  TryOnCallbackVerification,
  TryOnProviderRequest,
} from './provider';

/**
 * The mock try-on provider (clothing P05) — for development and tests only,
 * and labelled as such everywhere it shows.
 *
 * It is not an AI and it does not pretend to be one: it generates no image,
 * calls nothing, and every job it completes completes *without a result*.
 * The fitting room says exactly that ("mock provider — no AI image was
 * generated") and keeps pointing at the locally drawn fitting. What it does
 * exercise for real is everything around a provider: the job lifecycle,
 * idempotency, polling, cancellation, expiry, and signed callbacks.
 *
 * Deterministic and stateless: a job's id encodes when it was created, and
 * the job counts as done once `processingMs` has passed. So the same inputs
 * at the same clock give the same answers, with no process-local state for
 * a second server instance to disagree about.
 */

/** The header a callback's `t=<unix seconds>,v1=<hex>` signature arrives in. */
export const TRYON_SIGNATURE_HEADER = 'x-tryon-signature';

/** How long a mock job stays "processing" — long enough for the UI to show
 * the state, short enough that a test does not wait. */
export const MOCK_PROCESSING_MS = 1_500;

const MOCK_ID = /^mock_([0-9a-z]{1,12})_([0-9a-f]{16})$/;

/**
 * The callback body this project defines for providers that call back —
 * the mock's own format, since no vendor has been selected. A real adapter
 * parses its vendor's format in its own `verifyCallback`.
 */
const callbackSchema = z
  .object({
    eventId: z.string().min(1).max(128),
    providerJobId: z.string().min(1).max(128),
    status: z.enum(['completed', 'failed']),
    resultUrl: z.string().max(2048).nullable(),
    errorCode: z
      .string()
      .regex(/^[a-z0-9_]{1,64}$/)
      .nullable(),
    occurredAt: z.iso.datetime(),
  })
  .strict();

export interface MockProviderOptions {
  /** HMAC key callbacks are signed with (`AI_TRYON_WEBHOOK_SECRET`). */
  callbackSecret: string;
  clock?: () => Date;
  processingMs?: number;
}

export function createMockTryOnProvider(options: MockProviderOptions): AITryOnProvider {
  const clock = options.clock ?? (() => new Date());
  const processingMs = options.processingMs ?? MOCK_PROCESSING_MS;

  function stateOf(providerJobId: string): ProviderJobState | null {
    const match = MOCK_ID.exec(providerJobId);
    if (!match) return null;
    const createdMs = Number.parseInt(match[1]!, 36);
    const done = clock().getTime() - createdMs >= processingMs;
    return {
      providerJobId,
      status: done ? 'completed' : 'processing',
      // Never an image: the mock has none to give.
      resultUrl: null,
      errorCode: null,
    };
  }

  return {
    name: 'mock',
    isMock: true,
    requiresCustomerPhoto: false,

    async createJob(request: TryOnProviderRequest) {
      const digest = createHash('sha256').update(request.jobId).digest('hex').slice(0, 16);
      const providerJobId = `mock_${clock().getTime().toString(36)}_${digest}`;
      return stateOf(providerJobId)!;
    },

    async getJob(providerJobId) {
      return stateOf(providerJobId);
    },

    async cancelJob() {
      // Nothing is running anywhere; the job service records the cancel.
    },

    verifyCallback(rawBody, headers): TryOnCallbackVerification {
      const check = verifySignedPayload({
        secret: options.callbackSecret,
        rawBody,
        header: headers.get(TRYON_SIGNATURE_HEADER),
        now: clock(),
      });
      if (!check.ok) return { ok: false, reason: check.reason };

      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch {
        return { ok: false, reason: 'malformed_payload' };
      }
      const parsed = callbackSchema.safeParse(json);
      if (!parsed.success) return { ok: false, reason: 'malformed_payload' };

      const body = parsed.data;
      return {
        ok: true,
        callback: {
          eventId: body.eventId,
          occurredAt: new Date(body.occurredAt),
          state: {
            providerJobId: body.providerJobId,
            status: body.status,
            resultUrl: body.resultUrl,
            errorCode: body.status === 'failed' ? (body.errorCode ?? 'provider_failed') : null,
          },
        },
      };
    },
  };
}
