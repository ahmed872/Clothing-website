import { NextResponse } from 'next/server';

import { getTryOnJob } from '@/modules/tryon';
import { getOptionalCustomerAccount } from '@/lib/customers/customer-identity';
import { tryOnContext } from '@/lib/try-on/try-on';

/**
 * `GET /api/try-on/jobs/[id]` — the signed-in customer's own try-on job,
 * brought up to date (clothing P05). The fitting room polls it while a job
 * runs.
 *
 * Someone else's job id answers exactly like an id that does not exist
 * (404), so the route cannot be used to learn which jobs exist. A GET with
 * no customer-visible side effects: refreshing a job from the provider only
 * records what the provider already decided.
 */
export const dynamic = 'force-dynamic';

const PRIVATE = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const account = await getOptionalCustomerAccount();
  if (!account) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401, headers: PRIVATE });
  }
  const tryOn = tryOnContext();
  if (!tryOn) return NextResponse.json({ error: 'unavailable' }, { status: 404, headers: PRIVATE });

  const { id } = await context.params;
  const job = await getTryOnJob(account.customerId, id, tryOn);
  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: PRIVATE });
  return NextResponse.json({ job }, { headers: PRIVATE });
}
