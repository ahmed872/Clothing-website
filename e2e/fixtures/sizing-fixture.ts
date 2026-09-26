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
  /** Clothing P04 — two colours with swatches, for the fitting room. The
   * swatches are stored as hex digits and prefixed with `#` by the script. */
  fittingTee: {
    slug: 'e2e-fitting-tee',
    nameAr: 'تيشيرت غرفة القياس',
    nameEn: 'Fitting Room Tee',
    skuPrefix: 'E2E-FIT-TEE',
    sizes: ['S', 'M', 'L', 'XL'],
    colors: [
      { en: 'Black', ar: 'أسود', swatch: '1D1D20' },
      { en: 'Sand', ar: 'رملي', swatch: 'D8C4A2' },
    ],
    garmentType: 'T_SHIRT',
    chart: [
      { chestCm: '101', shoulderCm: '42', lengthCm: '68' },
      { chestCm: '107', shoulderCm: '44', lengthCm: '70' },
      { chestCm: '113', shoulderCm: '46', lengthCm: '72' },
      { chestCm: '119', shoulderCm: '48', lengthCm: '74' },
    ],
  },
  /** A full-length garment: sized by length, drawn from shoulders down. */
  fittingThobe: {
    slug: 'e2e-fitting-thobe',
    nameAr: 'ثوب غرفة القياس',
    nameEn: 'Fitting Room Thobe',
    skuPrefix: 'E2E-FIT-THOBE',
    sizes: ['52', '54', '56', '58'],
    colors: [{ en: 'White', ar: 'أبيض', swatch: 'F4F2EC' }],
    garmentType: 'THOBE',
    chart: [
      { lengthCm: '132.1', chestCm: '108' },
      { lengthCm: '137.2', chestCm: '112' },
      { lengthCm: '142.2', chestCm: '116' },
      { lengthCm: '147.3', chestCm: '120' },
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
