/**
 * `analytics` — reporting queries and rollups. Read-only by rule.
 *
 * May depend on: core
 * Must not depend on: anything else, and must not write
 *
 * P15 builds the store's first reporting: `getSalesReport()` answers what
 * was sold, when, by whom and under which coupon, entirely from data the
 * rest of the platform already records — orders, order items, customers
 * and coupon codes. Nothing here estimates, projects or fills a gap: where
 * the schema has no answer (a refund's amount, a product's page views) the
 * report says so rather than producing a plausible number.
 *
 * "Read-only" is enforced, not just documented — `read-only.test.ts` runs
 * every exported query against a database client that throws on any write.
 *
 * Other modules import `@/modules/analytics`, never a file inside it.
 */

export {
  getSalesReport,
  lastNDaysRange,
  previousRange,
  percentageChange,
  type ReportRange,
  type ReportTotals,
  type RevenueDay,
  type TopProduct,
  type StatusSlice,
  type CouponUsage,
  type SalesReport,
} from './report.service';
