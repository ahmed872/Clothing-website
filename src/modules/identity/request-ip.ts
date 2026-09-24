/**
 * Shared between both Auth.js instances (`auth.ts` admin, `customer-auth.ts`
 * storefront) — the two login surfaces rate-limit and audit-log by the same
 * (ip, email) shape, so they read the client's address the same way.
 */
export function getClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim() ?? null;
  return request.headers.get('x-real-ip');
}
