'use server';

import { z } from 'zod';

import { isAppError, toAppError } from '@/modules/core';
import {
  cancelTryOnJob,
  createTryOnJob,
  getTryOnJob,
  retryTryOnJob,
  type TryOnJobView,
} from '@/modules/tryon';
import { requireCustomerAccount } from '@/lib/customers/customer-identity';

import { buildTryOnSubject, tryOnContext } from './try-on';

/**
 * Starting, cancelling and retrying the customer's own AI try-on jobs
 * (clothing P05).
 *
 * The customer is always the session's (`requireCustomerAccount()` first);
 * no input carries a customer id, and a job id from someone else finds
 * nothing. Inputs are parsed by strict schemas, so an extra field — a photo,
 * a price, a customer id — is refused rather than ignored. What is sent to
 * the provider is rebuilt on the server (`buildTryOnSubject`).
 *
 * CSRF: Server Actions — POST-only, and Next.js aborts any whose `Origin`
 * does not match the host serving the page.
 *
 * Reading a job's progress is a GET route (`/api/try-on/jobs/[id]`), not an
 * action: actions from one page run one at a time, and a poll must never
 * hold up navigation.
 */

export type TryOnActionError =
  | 'unavailable'
  | 'consent_required'
  | 'invalid'
  | 'not_found'
  | 'rate_limited'
  | 'not_allowed'
  | 'session_expired'
  | 'generic';

export type TryOnActionResult =
  { ok: true; job: TryOnJobView } | { ok: false; error: TryOnActionError };

const startSchema = z
  .object({
    slug: z.string().min(1).max(200),
    variantId: z.uuid(),
    idempotencyKey: z.uuid(),
    consent: z.boolean(),
  })
  .strict();

const jobSchema = z.object({ jobId: z.uuid() }).strict();

const retrySchema = z.object({ jobId: z.uuid(), slug: z.string().min(1).max(200) }).strict();

function failure(error: unknown, action: string): TryOnActionResult {
  const appError = toAppError(error);
  // The code only — never the request.
  if (!isAppError(error)) console.error(`${action} failed`, appError.code);
  switch (appError.code) {
    case 'UNAUTHENTICATED':
      return { ok: false, error: 'session_expired' };
    case 'RATE_LIMITED':
      return { ok: false, error: 'rate_limited' };
    case 'CONFLICT':
    case 'INVALID_STATE_TRANSITION':
      return { ok: false, error: 'not_allowed' };
    default:
      return { ok: false, error: 'generic' };
  }
}

export async function startTryOnAction(input: unknown): Promise<TryOnActionResult> {
  try {
    const account = await requireCustomerAccount();
    const context = tryOnContext();
    if (!context) return { ok: false, error: 'unavailable' };

    const parsed = startSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'invalid' };
    // Consent is asked for every job, and never assumed.
    if (!parsed.data.consent) return { ok: false, error: 'consent_required' };

    const subject = await buildTryOnSubject(
      account.customerId,
      parsed.data.slug,
      parsed.data.variantId,
    );
    if (!subject) return { ok: false, error: 'not_found' };

    const job = await createTryOnJob(
      account.customerId,
      subject,
      { idempotencyKey: parsed.data.idempotencyKey, consentedAt: new Date() },
      context,
    );
    return { ok: true, job };
  } catch (error) {
    return failure(error, 'startTryOnAction');
  }
}

export async function cancelTryOnAction(input: unknown): Promise<TryOnActionResult> {
  try {
    const account = await requireCustomerAccount();
    const context = tryOnContext();
    if (!context) return { ok: false, error: 'unavailable' };
    const parsed = jobSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'invalid' };

    const job = await cancelTryOnJob(account.customerId, parsed.data.jobId, context);
    return job ? { ok: true, job } : { ok: false, error: 'not_found' };
  } catch (error) {
    return failure(error, 'cancelTryOnAction');
  }
}

export async function retryTryOnAction(input: unknown): Promise<TryOnActionResult> {
  try {
    const account = await requireCustomerAccount();
    const context = tryOnContext();
    if (!context) return { ok: false, error: 'unavailable' };
    const parsed = retrySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'invalid' };

    const current = await getTryOnJob(account.customerId, parsed.data.jobId, context);
    if (!current) return { ok: false, error: 'not_found' };
    // The slug must be this job's product: its variant is looked up there.
    const subject = await buildTryOnSubject(
      account.customerId,
      parsed.data.slug,
      current.variantId,
    );
    if (!subject) return { ok: false, error: 'not_found' };

    const job = await retryTryOnJob(account.customerId, parsed.data.jobId, subject, context);
    return job ? { ok: true, job } : { ok: false, error: 'not_found' };
  } catch (error) {
    return failure(error, 'retryTryOnAction');
  }
}
