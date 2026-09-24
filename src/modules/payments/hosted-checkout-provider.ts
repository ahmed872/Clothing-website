import 'server-only';

import { AppError, serverEnv } from '@/modules/core';

import type {
  CreateSessionInput,
  PaymentProviderAdapter,
  ProviderPaymentState,
  ProviderSession,
  VerifyResult,
} from './provider';
import { redactProviderPayload } from './redaction';
import { verifySignedPayload } from './signature';

/**
 * A hosted-checkout adapter: the store never sees card data, the provider
 * hosts the payment page, and the outcome arrives as a signed webhook.
 *
 * ── What this is, precisely ────────────────────────────────────────────────
 * This implements a complete, conventional hosted-checkout contract —
 * `POST /payment-sessions` to open a session, `GET /payment-sessions/{id}`
 * for canonical state, and HMAC-SHA256 signed webhooks — against whatever
 * base URL `PAYMENT_API_BASE_URL` names. It is not a vendor SDK and does not
 * claim fidelity to Tap, Paymob or Stripe: this environment has no
 * credentials for any of them, and writing code that asserts a specific
 * vendor's wire format without ever executing it against that vendor would
 * be a claim this phase cannot support.
 *
 * What *is* verified here is everything that does not depend on a vendor:
 * signature verification, replay windows, status mapping, redaction, and
 * every caller above it. Wiring a named vendor is one file implementing
 * `PaymentProviderAdapter` plus one enum value — the order domain does not
 * move (P11 §4).
 *
 * No card data is collected, transmitted or stored by this application. The
 * only things that cross this boundary are an amount the server read from
 * the order, a currency, an order number and a return URL.
 */

/** The store's own timeout for the provider call. A payment API that has not
 * answered in fifteen seconds has effectively failed, and a request left
 * hanging holds a server-action connection open behind it. */
const REQUEST_TIMEOUT_MS = 15_000;

type StatusWord = ProviderSession['status'];

/**
 * Provider vocabulary → ours. The one place a provider's words are
 * translated; nothing above this line ever sees a provider status string.
 * An unrecognised word is refused rather than guessed at — mapping an
 * unknown status to SUCCEEDED is the exact failure this phase exists to
 * prevent.
 */
const STATUS_MAP: Readonly<Record<string, StatusWord>> = {
  created: 'CREATED',
  initiated: 'CREATED',
  requires_action: 'REQUIRES_ACTION',
  pending: 'PENDING',
  processing: 'PENDING',
  authorized: 'PENDING',
  captured: 'SUCCEEDED',
  paid: 'SUCCEEDED',
  succeeded: 'SUCCEEDED',
  failed: 'FAILED',
  declined: 'FAILED',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
  expired: 'EXPIRED',
};

export function mapProviderStatus(raw: unknown): StatusWord | null {
  if (typeof raw !== 'string') return null;
  return STATUS_MAP[raw.trim().toLowerCase()] ?? null;
}

function config() {
  const env = serverEnv();
  if (!env.PAYMENT_API_BASE_URL || !env.PAYMENT_API_KEY || !env.PAYMENT_WEBHOOK_SECRET) {
    // Unreachable when the env schema did its job; a typed guard rather than
    // a non-null assertion, so a future schema change fails loudly here.
    throw new AppError('INTERNAL', {
      internalMessage: 'Payment provider enabled without complete configuration',
    });
  }
  return {
    baseUrl: env.PAYMENT_API_BASE_URL.replace(/\/+$/, ''),
    apiKey: env.PAYMENT_API_KEY,
    webhookSecret: env.PAYMENT_WEBHOOK_SECRET,
  };
}

async function call(path: string, init: RequestInit): Promise<unknown> {
  const { baseUrl, apiKey } = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        // The credential goes in a header, on this line, and nowhere else.
        // It is never put on a Payment row, in an error message, or in a log.
        authorization: `Bearer ${apiKey}`,
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new AppError('PAYMENT_FAILED', {
        // Status code and path only. The body can echo the request, and the
        // request carries the customer's details.
        internalMessage: `Payment provider returned ${response.status} for ${path}`,
        details: { providerStatus: response.status },
      });
    }
    return text ? (JSON.parse(text) as unknown) : {};
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('PAYMENT_FAILED', {
      internalMessage: `Payment provider call to ${path} did not complete`,
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }
}

function requireString(body: unknown, key: string): string {
  const value = (body as Record<string, unknown> | null)?.[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new AppError('PAYMENT_FAILED', {
      internalMessage: `Payment provider response is missing "${key}"`,
    });
  }
  return value;
}

function optionalString(body: unknown, key: string): string | null {
  const value = (body as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export const hostedCheckoutProvider: PaymentProviderAdapter = {
  name: 'HOSTED_CHECKOUT',

  async createSession(input: CreateSessionInput): Promise<ProviderSession> {
    const body = await call('/payment-sessions', {
      method: 'POST',
      headers: { 'idempotency-key': input.idempotencyKey },
      body: JSON.stringify({
        // Minor units, exactly as stored on the order. No arithmetic happens
        // here — this adapter is not allowed to have an opinion about price.
        amount: input.amountMinor,
        currency: input.currency,
        reference: input.orderNumber,
        // Echoed back on every event, which is how a webhook finds its
        // attempt without trusting anything the browser touched.
        client_reference: input.paymentId,
        return_url: input.returnUrl,
        customer: {
          email: input.customerEmail ?? undefined,
          phone: input.customerPhone ?? undefined,
        },
      }),
    });

    const status = mapProviderStatus((body as Record<string, unknown>).status) ?? 'CREATED';
    const expiresAtRaw = optionalString(body, 'expires_at');
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;

    return {
      reference: requireString(body, 'id'),
      checkoutUrl: requireString(body, 'checkout_url'),
      status,
      expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
      metadata: redactProviderPayload(body),
    };
  },

  async retrieveSession(reference: string): Promise<ProviderPaymentState | null> {
    const body = await call(`/payment-sessions/${encodeURIComponent(reference)}`, {
      method: 'GET',
    });
    const status = mapProviderStatus((body as Record<string, unknown>).status);
    if (!status) return null;

    const amount = (body as Record<string, unknown>).amount;
    return {
      reference: requireString(body, 'id'),
      status,
      amountMinor: typeof amount === 'number' ? amount : Number.NaN,
      currency: optionalString(body, 'currency') ?? '',
      failureCode: optionalString(body, 'failure_code'),
      failureMessage: optionalString(body, 'failure_message'),
      metadata: redactProviderPayload(body),
    };
  },

  verifyWebhook(rawBody: string, headers: Headers): VerifyResult {
    const { webhookSecret } = config();

    const check = verifySignedPayload({
      secret: webhookSecret,
      rawBody,
      header: headers.get('x-payment-signature'),
    });
    if (!check.ok) return { ok: false, reason: check.reason };

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return { ok: false, reason: 'malformed_payload' };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, reason: 'malformed_payload' };
    }

    const body = parsed as Record<string, unknown>;
    const externalEventId = typeof body.event_id === 'string' ? body.event_id : null;
    const eventType = typeof body.event_type === 'string' ? body.event_type : null;
    const reference = typeof body.id === 'string' ? body.id : null;
    if (!externalEventId || !eventType || !reference) {
      return { ok: false, reason: 'malformed_payload', eventType: eventType ?? undefined };
    }

    const status = mapProviderStatus(body.status);
    if (!status) return { ok: false, reason: 'unsupported_event', eventType };

    // The provider's own clock, not ours: ordering two deliveries by the
    // time they happened to arrive gets it wrong exactly when a retry
    // overtakes the original.
    const occurredRaw = typeof body.occurred_at === 'string' ? body.occurred_at : null;
    const occurredAt = occurredRaw ? new Date(occurredRaw) : null;
    if (!occurredAt || Number.isNaN(occurredAt.getTime())) {
      return { ok: false, reason: 'malformed_payload', eventType };
    }

    const amount = body.amount;
    return {
      ok: true,
      event: {
        externalEventId,
        eventType,
        reference,
        status,
        occurredAt,
        amountMinor: typeof amount === 'number' ? amount : null,
        currency: typeof body.currency === 'string' ? body.currency : null,
        failureCode: typeof body.failure_code === 'string' ? body.failure_code : null,
        failureMessage: typeof body.failure_message === 'string' ? body.failure_message : null,
        metadata: redactProviderPayload(body),
      },
    };
  },
};
