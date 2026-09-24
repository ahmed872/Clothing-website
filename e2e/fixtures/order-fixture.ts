/**
 * The one product the P10 order specs buy from — the single source of truth
 * for both `scripts/seed-e2e-orders-fixture.mts` (which creates it) and the
 * specs that add it to a cart.
 *
 * Deliberately not one of the demo cars: these specs place real orders,
 * which consume real stock, and draining the demo catalog would break every
 * other spec in the suite.
 */
export const E2E_ORDER_FIXTURE = {
  categorySlug: 'e2e-orders',
  categoryNameAr: 'طلبات الاختبار',
  categoryNameEn: 'E2E Orders',
  productSlug: 'e2e-order-fixture',
  productNameAr: 'منتج اختبار الطلبات',
  productNameEn: 'Order Fixture Product',
  descriptionAr: 'منتج مخصص لاختبارات الطلبات الآلية.',
  descriptionEn: 'A product reserved for automated order tests.',
  sku: 'E2E-ORDER-FIXTURE',
  /** 1 200.00 SAR — a round number, so a total is easy to read in a failure. */
  priceMinor: 120_000,
} as const;
