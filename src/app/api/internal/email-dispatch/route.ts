import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { serverEnv } from '@/modules/core';
import { dispatchPendingEmailEvents } from '@/lib/notifications/email-dispatcher';

/**
 * The outbox's dispatch trigger (P13 §8/§9) — the one place something
 * outside this process asks "is there mail to send". This deployment
 * targets Vercel (`docs/environments.md`'s "## Production (Vercel)"), which
 * has no long-running worker process to poll the outbox on its own, so a
 * scheduler calling this route on a cadence is the serverless-appropriate
 * shape: `vercel.json`'s `crons` entry calls it once daily (the fastest
 * Vercel's free Hobby plan allows — see `docs/environments.md`'s "Email
 * delivery (P13)" section for why a GitHub Actions workflow, not a tighter
 * Vercel cron, is this project's real 5-minute cadence), and Vercel Cron
 * sends `Authorization: Bearer $CRON_SECRET` automatically for routes it
 * invokes — set the Vercel project's `CRON_SECRET` to the same value as
 * `EMAIL_DISPATCH_SECRET` and that call authenticates the same way any
 * other caller's would.
 *
 * Never a public send primitive (P13 §9): this route takes no body and no
 * query parameter that influences what gets sent — recipient, link, and
 * content all come from whatever `dispatchPendingEmailEvents` finds already
 * queued in the database. A caller cannot choose a recipient, a token, or a
 * sender through this endpoint; the only thing a caller controls is *that*
 * a drain happens, and that requires the bearer secret below.
 *
 * GET, not POST: this is what Vercel Cron issues, and the operation is
 * idempotent-to-call (calling it twice in a row processes whatever is left
 * PENDING at that moment, which — thanks to the dispatcher's own atomic
 * claim — is exactly nothing already `SENT`/`SENDING`/`FAILED`), so there is
 * no state-mutation-via-GET concern the way there would be for a
 * non-idempotent action.
 */

export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return false;

  const provided = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(serverEnv().EMAIL_DISPATCH_SECRET);
  // Constant-time, and only after confirming equal length — `timingSafeEqual`
  // throws on a length mismatch rather than returning `false`, and the length
  // check itself must not branch on the secret's actual bytes either, which
  // comparing lengths (not contents) never does.
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    // No detail beyond 401 — an unauthenticated caller learns nothing about
    // why, which matters here since this endpoint's existence at all is
    // otherwise-undiscoverable infrastructure.
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const summary = await dispatchPendingEmailEvents();
  return NextResponse.json({ ok: true, ...summary });
}
