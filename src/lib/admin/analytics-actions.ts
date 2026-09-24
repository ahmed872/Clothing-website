import 'server-only';

import { requirePermission } from '@/modules/identity';
import { getSalesReport, lastNDaysRange, type SalesReport } from '@/modules/analytics';

/**
 * Reporting's one server boundary (P15).
 *
 * **`server-only`, not `'use server'`.** Every other `*-actions.ts` file in
 * this folder declares `'use server'` because a form in the browser calls
 * it. Nothing here mutates and nothing here is called from the browser —
 * the Analytics page is a Server Component that reads its own data — so
 * marking this a Server Action would publish an unauthenticated-by-default
 * POST endpoint returning the store's revenue, to buy nothing. `server-only`
 * gives the same boundary with no endpoint, and the build fails if a client
 * component ever imports it.
 *
 * It still opens with `requirePermission`, exactly like the mutating action
 * files, and for the same reason: `analytics.read` is a permission STAFF
 * does not hold, and "what the store earned last month" is not readable by
 * a shop-floor account just because it found the function. The page's own
 * `requireAdminPermission` guards the URL; this guards the data, and
 * `analytics-security-matrix.test.ts` calls it directly to prove it.
 *
 * It throws when refused rather than returning an `ActionResult`: a read
 * the caller was never allowed to make has no inline message to render,
 * because there is no screen to render it on.
 */

/** The four windows the screen offers. Not a free-form number: an arbitrary
 * `?range=100000` is a full table scan a URL should not be able to ask for. */
export const REPORT_RANGE_DAYS = [7, 30, 90, 365] as const;
export type ReportRangeDays = (typeof REPORT_RANGE_DAYS)[number];

export const DEFAULT_REPORT_RANGE_DAYS: ReportRangeDays = 30;

export function parseReportRangeDays(value: unknown): ReportRangeDays {
  const parsed = Number(value);
  return (REPORT_RANGE_DAYS as readonly number[]).includes(parsed)
    ? (parsed as ReportRangeDays)
    : DEFAULT_REPORT_RANGE_DAYS;
}

export async function getSalesReportAction(days: ReportRangeDays): Promise<SalesReport> {
  await requirePermission('analytics.read');
  return getSalesReport(lastNDaysRange(days));
}
