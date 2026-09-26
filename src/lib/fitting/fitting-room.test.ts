import { beforeEach, describe, expect, it } from 'vitest';

import { saveBodyProfile } from '@/modules/body-profile';
import { resetBodyProfileTables } from '@/modules/body-profile/testing';
import { createCategory, createProduct, publishProduct } from '@/modules/catalog';
import { resetCatalogTables } from '@/modules/catalog/testing';
import { db } from '@/modules/core';
import { registerCustomer } from '@/modules/customers';
import { resetCustomerTables } from '@/modules/customers/testing';
import { saveProductSizing } from '@/modules/sizing';
import { resetSizingTables } from '@/modules/sizing/testing';

import { loadFittingRoom } from './fitting-room';

/**
 * The fitting room's loader against the real database: who it is for, what
 * it trusts from the URL, and what it hands the page.
 */

const swatch = (digits: string) => `#${digits}`;
let counter = 0;

async function customer(chestCm: string | null) {
  counter += 1;
  const { customer: c } = await registerCustomer({
    email: `fit-${counter}-${Date.now()}@example.com`,
    password: 'correct-horse-9',
    name: 'Shopper',
  });
  if (chestCm !== null) {
    await saveBodyProfile(c.id, {
      gender: 'MALE',
      heightCm: '177',
      weightKg: '78',
      waistCm: '84',
      chestCm,
      shoulderCm: '45',
    });
  }
  return c.id;
}

async function product(slug: string, { sizing = true } = {}) {
  const category = await createCategory({
    slug: `fit-${slug}`,
    nameAr: 'فئة',
    nameEn: `Category ${slug}`,
  });
  const sizes = ['S', 'M', 'L', 'XL'];
  const colors = ['Black', 'Sand'];
  const created = await createProduct({
    product: { slug, nameAr: 'تيشيرت', nameEn: 'Tee', categoryId: category.id },
    options: [
      { nameAr: 'اللون', nameEn: 'Color', values: colors.map((c) => ({ valueAr: c, valueEn: c })) },
      { nameAr: 'المقاس', nameEn: 'Size', values: sizes.map((s) => ({ valueAr: s, valueEn: s })) },
    ],
    variants: colors.flatMap((c, ci) =>
      sizes.map((s, si) => ({
        sku: `${slug}-${c}-${s}`,
        priceMinor: 25_000 + si * 1_000,
        stockQuantity: 5,
        position: ci * sizes.length + si,
        optionValues: [
          { optionNameEn: 'Color', valueEn: c },
          { optionNameEn: 'Size', valueEn: s },
        ],
      })),
    ),
  });
  await publishProduct(created.id);
  const options = await db.productOption.findMany({
    where: { productId: created.id },
    include: { values: { orderBy: { position: 'asc' } } },
  });
  const size = options.find((o) => o.nameEn === 'Size')!;
  const color = options.find((o) => o.nameEn === 'Color')!;
  if (sizing) {
    await saveProductSizing(created.id, {
      garmentType: 'T_SHIRT',
      sizeOptionId: size.id,
      entries: size.values.map((v, i) => ({
        optionValueId: v.id,
        measurements: { chestCm: String(101 + i * 6), shoulderCm: String(42 + i * 2) },
      })),
      colorOptionId: color.id,
      swatches: [{ optionValueId: color.values[0]!.id, hex: swatch('1D1D20') }],
    });
  }
  return {
    id: created.id,
    slug,
    size: Object.fromEntries(size.values.map((v) => [v.valueEn, v.id])),
    color: Object.fromEntries(color.values.map((v) => [v.valueEn, v.id])),
  };
}

beforeEach(async () => {
  await resetSizingTables();
  await resetBodyProfileTables();
  await resetCatalogTables();
  await resetCustomerTables();
});

describe('loadFittingRoom', () => {
  it('fits every size on the customer’s own profile, starting on the recommendation', async () => {
    const p = await product('tee-a');
    const me = await customer('97');
    const data = await loadFittingRoom(me, p.slug, {});
    expect(data.status).toBe('ready');
    if (data.status !== 'ready') return;
    expect(data.results.map((r) => r.size.label.en)).toEqual(['S', 'M', 'L', 'XL']);
    expect(data.initial.sizeId).toBe(p.size.M);
    expect(data.results[1]!.relation).toEqual({ kind: 'recommended' });
    expect(data.colors).toEqual([
      { valueId: p.color.Black, label: { ar: 'Black', en: 'Black' }, swatchHex: swatch('1D1D20') },
      { valueId: p.color.Sand, label: { ar: 'Sand', en: 'Sand' }, swatchHex: null },
    ]);
    // Prices and stock are the catalog's.
    const variant = data.variants.find(
      (v) => v.optionValueIds.includes(p.size.L!) && v.optionValueIds.includes(p.color.Black!),
    );
    expect(variant?.price.currentMinor).toBe(27_000);
  });

  it('starts on a colour and size from the URL when they are this product’s', async () => {
    const p = await product('tee-b');
    const me = await customer('97');
    const data = await loadFittingRoom(me, p.slug, { color: p.color.Sand, size: p.size.XL });
    expect(data).toMatchObject({ initial: { colorId: p.color.Sand, sizeId: p.size.XL } });
  });

  it('ignores ids from another product, or none at all, in the URL', async () => {
    const p = await product('tee-c');
    const other = await product('tee-d');
    const me = await customer('97');
    const data = await loadFittingRoom(me, p.slug, { color: other.color.Sand, size: 'not-an-id' });
    expect(data).toMatchObject({ initial: { colorId: p.color.Black, sizeId: p.size.M } });
  });

  it('two customers see their own fittings', async () => {
    const p = await product('tee-e');
    const smaller = await customer('97');
    const larger = await customer('103');
    const a = await loadFittingRoom(smaller, p.slug, {});
    const b = await loadFittingRoom(larger, p.slug, {});
    expect(a).toMatchObject({ initial: { sizeId: p.size.M } });
    expect(b).toMatchObject({ initial: { sizeId: p.size.L } });
    if (a.status === 'ready' && b.status === 'ready') {
      expect(a.profile.measurements.chestCm).toBe(97);
      expect(b.profile.measurements.chestCm).toBe(103);
    }
  });

  it('a fit to try recalculates on the server and saves nothing', async () => {
    const p = await product('tee-f');
    const me = await customer('97');
    const data = await loadFittingRoom(me, p.slug, { fit: 'RELAXED' });
    expect(data).toMatchObject({ initial: { sizeId: p.size.XL } });
    const saved = await db.bodyProfile.findUniqueOrThrow({ where: { customerId: me } });
    expect(saved.fitPreference).toBe('REGULAR');
  });

  it('says what is missing: no profile, no sizing, no such product', async () => {
    const p = await product('tee-g');
    expect(await loadFittingRoom(await customer(null), p.slug, {})).toMatchObject({
      status: 'no_profile',
    });
    const bare = await product('tee-h', { sizing: false });
    expect(await loadFittingRoom(await customer('97'), bare.slug, {})).toMatchObject({
      status: 'not_available',
    });
    expect(await loadFittingRoom(await customer('97'), 'no-such-product', {})).toEqual({
      status: 'not_found',
    });
  });
});
