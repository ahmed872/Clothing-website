/**
 * Clothing P02 — the products the size recommendation specs use, created by
 * `pnpm db:seed-e2e-sizing` (idempotent).
 *
 * Their category is a *child* of the account fixture's category, so it
 * never joins the storefront header's top-level links (every top-level
 * category is a header link, and too many squeeze the store name).
 *
 *   - `tee`: a published T-shirt, S–XL, with a size chart set by the fixture
 *     script — the customer journeys read it and never change it;
 *   - `adminShirt`: a published shirt, S–L, which the admin spec gives a
 *     chart through the editor (removing any chart a previous run left).
 */
export const E2E_SIZING_FIXTURE = {
  parentCategory: { slug: 'e2e-account', nameAr: 'حساب الاختبار', nameEn: 'E2E Account' },
  category: { slug: 'e2e-sizing', nameAr: 'اختبار المقاسات', nameEn: 'E2E Sizing' },
  tee: {
    slug: 'e2e-sizing-tee',
    nameAr: 'تيشيرت اختبار المقاسات',
    nameEn: 'Sizing Fixture Tee',
    skuPrefix: 'E2E-SIZING-TEE',
    sizes: ['S', 'M', 'L', 'XL'],
    chart: [
      { chestCm: '101', shoulderCm: '42', lengthCm: '68' },
      { chestCm: '107', shoulderCm: '44', lengthCm: '70' },
      { chestCm: '113', shoulderCm: '46', lengthCm: '72' },
      { chestCm: '119', shoulderCm: '48', lengthCm: '74' },
    ],
  },
  adminShirt: {
    slug: 'e2e-sizing-admin-shirt',
    nameAr: 'قميص اختبار المقاسات',
    nameEn: 'Sizing Fixture Shirt',
    skuPrefix: 'E2E-SIZING-SHIRT',
    sizes: ['S', 'M', 'L'],
  },
} as const;
