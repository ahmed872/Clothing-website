/**
 * The clothing P02 e2e fixture (see `e2e/fixtures/sizing-fixture.ts`):
 * two published products with Color × Size variants, the tee with its size
 * chart. Idempotent, and safe for several spec files' `beforeAll` at once —
 * every create tolerates having lost a race to an identical one.
 *
 * Prints one line of JSON — the ids the specs navigate by — last.
 *
 * Run with: pnpm db:seed-e2e-sizing
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env', quiet: true });

const { createCategory, getCategoryBySlug, createProduct, getProductBySlug, publishProduct } =
  await import('../src/modules/catalog/index.js');
const { db } = await import('../src/modules/core/index.js');
const { saveProductSizing, getProductSizing } = await import('../src/modules/sizing/index.js');
const { E2E_SIZING_FIXTURE: F } = await import('../e2e/fixtures/sizing-fixture.js');

async function ensureCategory(input: {
  slug: string;
  nameAr: string;
  nameEn: string;
  parentId?: string;
}) {
  const existing = await getCategoryBySlug(input.slug);
  if (existing) return existing;
  try {
    return await createCategory(input);
  } catch {
    // Another spec's beforeAll created it first.
    return (await getCategoryBySlug(input.slug))!;
  }
}

const parent = await ensureCategory(F.parentCategory);
const category = await ensureCategory({ ...F.category, parentId: parent.id });

async function ensureProduct(p: {
  slug: string;
  nameAr: string;
  nameEn: string;
  skuPrefix: string;
  sizes: readonly string[];
}): Promise<string> {
  const existing = await getProductBySlug(p.slug);
  if (existing) return existing.id;
  try {
    const created = await createProduct({
      product: { slug: p.slug, nameAr: p.nameAr, nameEn: p.nameEn, categoryId: category.id },
      options: [
        { nameAr: 'اللون', nameEn: 'Color', values: [{ valueAr: 'أسود', valueEn: 'Black' }] },
        {
          nameAr: 'المقاس',
          nameEn: 'Size',
          values: p.sizes.map((size) => ({ valueAr: size, valueEn: size })),
        },
      ],
      variants: p.sizes.map((size, position) => ({
        sku: `${p.skuPrefix}-${size}`,
        priceMinor: 25_000,
        stockQuantity: 500,
        position,
        optionValues: [
          { optionNameEn: 'Color', valueEn: 'Black' },
          { optionNameEn: 'Size', valueEn: size },
        ],
      })),
    });
    await publishProduct(created.id);
    return created.id;
  } catch {
    return (await getProductBySlug(p.slug))!.id;
  }
}

const teeId = await ensureProduct(F.tee);
const shirtId = await ensureProduct(F.adminShirt);

if (!(await getProductSizing(teeId))) {
  const sizeOption = await db.productOption.findFirstOrThrow({
    where: { productId: teeId, nameEn: 'Size' },
    include: { values: { orderBy: { position: 'asc' } } },
  });
  try {
    await saveProductSizing(teeId, {
      garmentType: 'T_SHIRT',
      sizeOptionId: sizeOption.id,
      entries: sizeOption.values.map((value, index) => ({
        optionValueId: value.id,
        measurements: F.tee.chart[index]!,
      })),
    });
  } catch {
    // Lost the race to an identical save from another beforeAll.
  }
}

console.log(JSON.stringify({ teeId, shirtId }));
await db.$disconnect();
