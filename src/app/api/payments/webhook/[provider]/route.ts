import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import { getPaymentProvider } from '@/modules/payments';
import { applyVerifiedEvent, recordRejectedDelivery } from '@/modules/orders';

/**
 * The provider's callback (P11 §10).
 *
 * This is the only place in the application where a payment can move
 * forward, and everything about it is arranged so that it cannot be talked
 * into moving one it should not:
 *
 *   • The raw body is read as text and verified as text. Parsing first and
 *     verifying the re-serialised object is how signature checks quietly
 *     stop working — key order and whitespace change, the HMAC no longer
 *     matches what was signed, and the natural "fix" is to stop checking.
 *
 *   • Verification happens before anything is looked up. An unsigned or
 *     badly signed delivery never reaches an attempt; it is recorded as a
 *     rejection and answered 400.
 *
 *   • No session, no cookie, no CSRF token is consulted, because the caller
 *     is a server on the internet, not a browser. The signature *is* the
 *     authentication. That is also why there is no authenticated variant of
 *     this route: adding one would create a second, weaker way in.
 *
 * Status codes are chosen for how a provider retries. A signature failure is
 * permanent — retrying will not fix it — so it gets 400 and the provider
 * gives up. An error on our side is transient, so it gets 500 and the
 * provider tries again, which is safe precisely because processing is
 * idempotent. Everything successfully handled, duplicates included, gets 200.
 */

export const dynamic = 'force-dynamic';

/** A stable id for a delivery that never produced a usable event id, so two
 * different rejected bodies do not collapse into one row and a replayed
 * rejection does not create a new one on every attempt. */
function fingerprint(rawBody: string): string {
  return `rejected:${createHash('sha256').update(rawBody).digest('hex').slice(0, 32)}`;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider: providerParam } = await context.params;

  const adapter = getPaymentProvider();
  // A webhook for a provider this deployment does not run. Answered 404 with
  // no detail: the endpoint should not tell an unauthenticated caller which
  // providers are configured.
  if (!adapter || adapter.name.toLowerCase() !== providerParam.toLowerCase()) {
    return NextResponse.json({ received: false }, { status: 404 });
  }

  const rawBody = await request.text();

  const verification = adapter.verifyWebhook(rawBody, request.headers);
  if (!verification.ok) {
    // Recorded, not processed. An endpoint being probed is worth seeing, and
    // seeing it requires a row — but the row is written with
    // `signatureValid: false` and no payment attached, and there is no code
    // path from it into the payment machine.
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      // A body that is not even JSON still gets a row, with nothing in it.
    }
    await recordRejectedDelivery({
      provider: adapter.name,
      reason: verification.reason,
      eventType: verification.eventType ?? null,
      externalEventId: fingerprint(rawBody),
      rawPayload: parsed,
    });
    // The reason is deliberately not returned: telling a caller whether the
    // signature was absent, wrong, or merely stale is a hint they can tune
    // against.
    return NextResponse.json({ received: false }, { status: 400 });
  }

  try {
    const result = await applyVerifiedEvent({
      provider: adapter.name,
      event: verification.event,
      rawPayload: JSON.parse(rawBody),
    });
    // 200 for every handled outcome, duplicates included: the provider's job
    // is done and it should stop retrying. What actually happened is in the
    // `webhook_events` row, not in this response.
    return NextResponse.json({ received: true, outcome: result.kind }, { status: 200 });
  } catch {
    // Our fault, so the provider should retry — which is safe because
    // reprocessing the same event id is a no-op. Nothing about the error is
    // returned or logged here; the failure is already on the webhook row.
    return NextResponse.json({ received: false }, { status: 500 });
  }
}
