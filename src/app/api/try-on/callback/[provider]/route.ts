import { NextResponse } from 'next/server';

import { applyTryOnCallback } from '@/modules/tryon';
import { tryOnContext } from '@/lib/try-on/try-on';

/**
 * `POST /api/try-on/callback/[provider]` — a try-on provider reporting a
 * job's outcome (clothing P05).
 *
 * The signature is the authentication: no session or cookie is consulted,
 * because the caller is a server. The raw body is verified as text before
 * anything is parsed or looked up (HMAC-SHA256 over `<timestamp>.<body>`,
 * with the timestamp inside the signature and a five-minute window, so a
 * captured delivery cannot be replayed later), and the job service only
 * moves an unfinished job forward — so a replay inside the window, or a
 * late duplicate, changes nothing.
 *
 * Bodies are capped while being read, so an oversized upload is refused
 * without being buffered. Refusals do not say why: telling a caller whether
 * a signature was missing, wrong or stale is a hint to tune against.
 */
export const dynamic = 'force-dynamic';

/** A callback is a few hundred bytes of JSON; anything near this is not one. */
const MAX_CALLBACK_BYTES = 16 * 1024;

async function readLimited(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await context.params;
  const tryOn = tryOnContext();
  // A provider this deployment does not run: answered 404 with no detail.
  if (!tryOn || tryOn.provider.name !== provider) {
    return NextResponse.json({ received: false }, { status: 404 });
  }

  const rawBody = await readLimited(request, MAX_CALLBACK_BYTES);
  if (rawBody === null) return NextResponse.json({ received: false }, { status: 413 });

  const verification = tryOn.provider.verifyCallback(rawBody, request.headers);
  if (!verification.ok) return NextResponse.json({ received: false }, { status: 400 });

  try {
    const outcome = await applyTryOnCallback(verification.callback, tryOn);
    // 200 for every handled outcome, duplicates included: the provider
    // should stop retrying.
    return NextResponse.json({ received: true, outcome }, { status: 200 });
  } catch {
    // Ours, so the provider should retry — safe, since applying is idempotent.
    return NextResponse.json({ received: false }, { status: 500 });
  }
}
