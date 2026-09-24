import { vi } from 'vitest';

import { buildSignatureHeader } from './signature';
import type { VerifiedProviderEvent } from './provider';

/**
 * A stand-in for the provider's HTTP API, for tests.
 *
 * This stubs the *provider*, never this application's own verification. A
 * webhook built here is signed with the real configured secret and goes
 * through the real `verifyWebhook`; nothing in these helpers can mark a
 * payment paid on its own. That distinction is the whole point: what is
 * being tested is our handling of a provider's answers, and the only thing
 * unavailable in this environment is a specific vendor's servers.
 */

export const TEST_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? '';

export interface StubSession {
  id: string;
  status: string;
  amount: number;
  currency: string;
  checkout_url: string;
  expires_at?: string;
}

interface StubOptions {
  /** Status the created session reports. */
  createStatus?: string;
  /** What `retrieveSession` answers, keyed by session id. */
  retrieve?: Record<string, Partial<StubSession> & { status: string }>;
  /** Make session creation fail, to exercise the slot-freeing path. */
  failCreate?: boolean;
  /** Amount the provider claims, when testing a mismatch. */
  amountOverride?: number;
}

let sessionCounter = 0;

/** Installs the stub. Returns the list of session ids it issued, in order. */
export function stubPaymentProviderApi(options: StubOptions = {}): {
  sessions: StubSession[];
  restore: () => void;
} {
  const sessions: StubSession[] = [];

  const fetchStub = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('/payment-sessions') && (init?.method ?? 'GET') === 'POST') {
      if (options.failCreate) {
        return new Response('{"error":"provider down"}', { status: 502 });
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        amount: number;
        currency: string;
      };
      sessionCounter += 1;
      const session: StubSession = {
        id: `sess_${sessionCounter}`,
        status: options.createStatus ?? 'created',
        amount: options.amountOverride ?? body.amount,
        currency: body.currency,
        checkout_url: `https://provider.example/pay/sess_${sessionCounter}`,
      };
      sessions.push(session);
      return new Response(JSON.stringify(session), { status: 201 });
    }

    // GET /payment-sessions/{id}
    const match = /\/payment-sessions\/([^/?]+)$/.exec(url);
    if (match) {
      const id = decodeURIComponent(match[1]!);
      const known = sessions.find((s) => s.id === id);
      const override = options.retrieve?.[id];
      if (!known && !override) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify({ ...known, ...override, id }), { status: 200 });
    }

    return new Response('{}', { status: 404 });
  });

  vi.stubGlobal('fetch', fetchStub);
  return { sessions, restore: () => vi.unstubAllGlobals() };
}

/** A provider webhook body, in the shape the hosted-checkout adapter parses. */
export function webhookBody(overrides: {
  event_id: string;
  id: string;
  status: string;
  occurred_at: string;
  amount?: number;
  currency?: string;
  event_type?: string;
  failure_code?: string;
  failure_message?: string;
}): string {
  return JSON.stringify({
    event_type: overrides.event_type ?? `payment.${overrides.status}`,
    ...overrides,
  });
}

/** Signs a body with the configured secret — the real algorithm, so the real
 * verification runs. */
export function signedHeaders(rawBody: string, now = new Date()): Headers {
  return new Headers({
    'content-type': 'application/json',
    'x-payment-signature': buildSignatureHeader(TEST_WEBHOOK_SECRET, rawBody, now),
  });
}

/** A verified event object, for tests that exercise the domain below the
 * signature layer directly. Building one of these by hand is only legitimate
 * because the signature layer has its own tests; nothing in production can
 * construct one without verifying first. */
export function verifiedEvent(
  overrides: Partial<VerifiedProviderEvent> & Pick<VerifiedProviderEvent, 'reference' | 'status'>,
): VerifiedProviderEvent {
  return {
    externalEventId: `evt_${Math.random().toString(36).slice(2, 10)}`,
    eventType: `payment.${overrides.status.toLowerCase()}`,
    occurredAt: new Date(),
    amountMinor: null,
    currency: null,
    failureCode: null,
    failureMessage: null,
    metadata: {},
    ...overrides,
  };
}
