import { NextResponse } from 'next/server';

import { getSizeRecommendationView } from '@/lib/sizing/size-recommendation-view';

/**
 * `GET /api/size-recommendation?productId=…&fit=…` — the signed-in
 * customer's size recommendation for one product (clothing P02). See
 * `size-recommendation-view.ts` for what it trusts and what it returns.
 *
 * A read with no side effects, so a GET: nothing a cross-site request could
 * trigger changes anything, and the session cookie (`SameSite=Lax`) is not
 * sent on a cross-site fetch anyway. The answer is personal, so it is never
 * cached by anything between the server and this customer's browser.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const view = await getSizeRecommendationView(
    params.get('productId') ?? '',
    params.get('fit') ?? undefined,
  );
  return NextResponse.json(view, {
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' },
  });
}
