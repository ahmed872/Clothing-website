/**
 * Two always-restocked products for the P12 account specs — the guest-cart
 * merge test needs to prove that *two distinct* items both survive into the
 * signed-in customer's cart, so one fixture product (as `order-fixture.ts`
 * uses for the order specs) is not enough on its own. Deliberately separate
 * from `order-fixture.ts`'s single SKU rather than reusing it twice: two
 * calls to add "the same" fixture item would only prove quantity-increment
 * behaviour, not that a second, different line survived the merge.
 */
export const E2E_ACCOUNT_FIXTURE = {
  categorySlug: 'e2e-account',
  categoryNameAr: 'حساب الاختبار',
  categoryNameEn: 'E2E Account',
  productA: {
    slug: 'e2e-account-fixture-a',
    nameAr: 'منتج اختبار الحساب أ',
    nameEn: 'Account Fixture Product A',
    sku: 'E2E-ACCOUNT-FIXTURE-A',
    priceMinor: 80_000,
  },
  productB: {
    slug: 'e2e-account-fixture-b',
    nameAr: 'منتج اختبار الحساب ب',
    nameEn: 'Account Fixture Product B',
    sku: 'E2E-ACCOUNT-FIXTURE-B',
    priceMinor: 95_000,
  },
} as const;
