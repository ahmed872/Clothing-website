import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';
import { resetCatalogTables } from '@/modules/catalog/testing';
import { saveBodyProfile } from '@/modules/body-profile';
import { resetBodyProfileTables } from '@/modules/body-profile/testing';
import { registerCustomer } from '@/modules/customers';
import { resetCustomerTables } from '@/modules/customers/testing';

import { sizeChartErrorsFromIssues, sizeChartInputSchema } from './size-chart.schemas';
import {
  deleteProductSizing,
  getProductSizing,
  getStorefrontSizeChart,
  saveProductSizing,
} from './size-chart.service';
import { recommendSizeForCustomer } from './customer-recommendation.service';
import { resetSizingTables } from './testing';

/**
 * Size charts against the real database: validation, ownership of every id
 * a chart names, ordering, concurrency, and what a shopper may read.
 */

interface SeededProduct {
  id: string;
  sizeOptionId: string;
  colorOptionId: string;
  sizes: Record<string, string>;
  colors: Record<string, string>;
}

let counter = 0;
async function seedProduct(status: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED'): Promise<SeededProduct> {
  counter += 1;
  const category =
    (await db.category.findFirst({ where: { slug: 'sizing-test' } })) ??
    (await db.category.create({ data: { slug: 'sizing-test', nameAr: 'اختبار', nameEn: 'Test' } }));
  const product = await db.product.create({
    data: {
      slug: `tee-${counter}`,
      nameAr: 'تيشيرت',
      nameEn: 'Tee',
      categoryId: category.id,
      status,
      publishedAt: status === 'PUBLISHED' ? new Date() : null,
    },
  });
  const size = await db.productOption.create({
    data: {
      productId: product.id,
      nameAr: 'المقاس',
      nameEn: 'Size',
      position: 1,
      values: {
        create: ['S', 'M', 'L'].map((value, position) => ({
          valueAr: value,
          valueEn: value,
          position,
        })),
      },
    },
    include: { values: true },
  });
  const color = await db.productOption.create({
    data: {
      productId: product.id,
      nameAr: 'اللون',
      nameEn: 'Color',
      position: 0,
      values: { create: [{ valueAr: 'أسود', valueEn: 'Black', position: 0 }] },
    },
    include: { values: true },
  });
  return {
    id: product.id,
    sizeOptionId: size.id,
    colorOptionId: color.id,
    sizes: Object.fromEntries(size.values.map((v) => [v.valueEn, v.id])),
    colors: Object.fromEntries(color.values.map((v) => [v.valueEn, v.id])),
  };
}

function teeChart(p: SeededProduct) {
  return {
    garmentType: 'T_SHIRT' as const,
    sizeOptionId: p.sizeOptionId,
    entries: [
      {
        optionValueId: p.sizes.S!,
        measurements: { chestCm: '101', shoulderCm: '42', lengthCm: '68' },
      },
      {
        optionValueId: p.sizes.M!,
        measurements: { chestCm: '107', shoulderCm: '44', lengthCm: '70' },
      },
      {
        optionValueId: p.sizes.L!,
        measurements: { chestCm: '113', shoulderCm: '46', lengthCm: '72' },
      },
    ],
  };
}

function errorsFor(input: unknown) {
  const result = sizeChartInputSchema.safeParse(input);
  expect(result.success).toBe(false);
  return sizeChartErrorsFromIssues(result.error!.issues);
}

beforeEach(async () => {
  await resetSizingTables();
  await resetBodyProfileTables();
  await resetCatalogTables();
  await resetCustomerTables();
});

describe('sizeChartInputSchema', () => {
  const ids = {
    option: '5e0f3a4e-1111-4b8e-9c1f-111111111111',
    a: '5e0f3a4e-2222-4b8e-9c1f-222222222222',
    b: '5e0f3a4e-3333-4b8e-9c1f-333333333333',
  };

  it('stores centimetres at one decimal, from any digits the admin types', () => {
    const data = sizeChartInputSchema.parse({
      garmentType: 'T_SHIRT',
      sizeOptionId: ids.option,
      entries: [{ optionValueId: ids.a, measurements: { chestCm: '١٠٧٫٥٥', shoulderCm: 44 } }],
    });
    expect(data.entries[0]!.measurements).toEqual({ chestCm: 107.6, shoulderCm: 44 });
  });

  it('refuses negative, impossible and malformed values per cell', () => {
    expect(
      errorsFor({
        garmentType: 'T_SHIRT',
        sizeOptionId: ids.option,
        entries: [
          { optionValueId: ids.a, measurements: { chestCm: '-5', shoulderCm: '400' } },
          { optionValueId: ids.b, measurements: { chestCm: '10', shoulderCm: '4x' } },
        ],
      }).entries,
    ).toEqual({
      0: { chestCm: 'invalid_number', shoulderCm: 'too_large' },
      1: { chestCm: 'too_small', shoulderCm: 'invalid_number' },
    });
  });

  it('requires what the garment is sized by, and refuses what it cannot hold', () => {
    expect(
      errorsFor({
        garmentType: 'JEANS',
        sizeOptionId: ids.option,
        entries: [{ optionValueId: ids.a, measurements: { chestCm: '100', hipCm: '99' } }],
      }).entries,
    ).toEqual({ 0: { chestCm: 'not_applicable', waistCm: 'required' } });
  });

  it('refuses the same size twice', () => {
    expect(
      errorsFor({
        garmentType: 'T_SHIRT',
        sizeOptionId: ids.option,
        entries: [
          { optionValueId: ids.a, measurements: { chestCm: '100' } },
          { optionValueId: ids.a, measurements: { chestCm: '106' } },
        ],
      }).entries,
    ).toEqual({ 1: { optionValueId: 'duplicate_size' } });
  });

  it('refuses malformed data and fields it does not define', () => {
    expect(errorsFor({ garmentType: 'CAPE' }).garmentType).toBe('invalid_option');
    expect(errorsFor({ garmentType: '' }).garmentType).toBe('required');
    expect(errorsFor({ garmentType: 'T_SHIRT', productId: ids.a }).form).toBe('unknown_field');
    expect(
      errorsFor({
        garmentType: 'T_SHIRT',
        sizeOptionId: ids.option,
        entries: [{ optionValueId: 'not-a-uuid', measurements: { chestCm: '100' } }],
      }).entries,
    ).toEqual({ 0: { optionValueId: 'invalid_option' } });
    expect(
      errorsFor({
        garmentType: 'T_SHIRT',
        sizeOptionId: ids.option,
        entries: [{ optionValueId: ids.a, measurements: { chestCm: '100', bicepCm: '30' } }],
      }).entries,
    ).toEqual({ 0: { bicepCm: 'unknown_field' } });
  });

  it('sizes need a size option', () => {
    expect(
      errorsFor({
        garmentType: 'T_SHIRT',
        entries: [{ optionValueId: ids.a, measurements: { chestCm: '100' } }],
      }).sizeOptionId,
    ).toBe('size_option_required');
  });
});

describe('saveProductSizing', () => {
  it('saves the garment type and the chart in the order given', async () => {
    const p = await seedProduct();
    const saved = await saveProductSizing(p.id, teeChart(p), { expectedUpdatedAt: null });
    expect(saved.garmentType).toBe('T_SHIRT');
    expect(saved.sizeOption).toMatchObject({
      id: p.sizeOptionId,
      nameEn: 'Size',
      nameAr: 'المقاس',
    });
    expect(saved.entries.map((e) => [e.labelEn, e.measurements])).toEqual([
      ['S', { chestCm: 101, shoulderCm: 42, lengthCm: 68 }],
      ['M', { chestCm: 107, shoulderCm: 44, lengthCm: 70 }],
      ['L', { chestCm: 113, shoulderCm: 46, lengthCm: 72 }],
    ]);
  });

  it('reorders, edits and removes sizes by saving the chart again', async () => {
    const p = await seedProduct();
    const first = await saveProductSizing(p.id, teeChart(p), { expectedUpdatedAt: null });
    const chart = teeChart(p);
    const reordered = {
      ...chart,
      entries: [{ ...chart.entries[1]!, measurements: { chestCm: '108' } }, chart.entries[0]!],
    };
    const second = await saveProductSizing(p.id, reordered, { expectedUpdatedAt: first.updatedAt });
    expect(second.entries.map((e) => [e.labelEn, e.measurements.chestCm])).toEqual([
      ['M', 108],
      ['S', 101],
    ]);
    expect(await db.sizeChartEntry.count()).toBe(2);
  });

  it('keeps the garment type without any sizes', async () => {
    const p = await seedProduct();
    const saved = await saveProductSizing(p.id, { garmentType: 'ABAYA' });
    expect(saved).toMatchObject({ garmentType: 'ABAYA', sizeOption: null, entries: [] });
  });

  it("refuses another product's size option", async () => {
    const mine = await seedProduct();
    const theirs = await seedProduct();
    await expect(
      saveProductSizing(mine.id, {
        ...teeChart(mine),
        sizeOptionId: theirs.sizeOptionId,
        entries: [],
      }),
    ).rejects.toMatchObject({ details: { reasonCode: 'sizing_option_not_on_product' } });
    expect(await getProductSizing(mine.id)).toBeNull();
  });

  it("refuses another product's sizes, and values that are not sizes", async () => {
    const mine = await seedProduct();
    const theirs = await seedProduct();
    const chart = teeChart(mine);
    await expect(
      saveProductSizing(mine.id, {
        ...chart,
        entries: [{ optionValueId: theirs.sizes.M!, measurements: { chestCm: '107' } }],
      }),
    ).rejects.toMatchObject({ details: { reasonCode: 'sizing_value_not_in_option' } });
    await expect(
      saveProductSizing(mine.id, {
        ...chart,
        entries: [{ optionValueId: mine.colors.Black!, measurements: { chestCm: '107' } }],
      }),
    ).rejects.toMatchObject({ details: { reasonCode: 'sizing_value_not_in_option' } });
    expect(await db.sizeChartEntry.count()).toBe(0);
  });

  it('a stale save is refused rather than overwriting another edit', async () => {
    const p = await seedProduct();
    const first = await saveProductSizing(p.id, teeChart(p), { expectedUpdatedAt: null });
    await saveProductSizing(
      p.id,
      { ...teeChart(p), garmentType: 'SHIRT' },
      {
        expectedUpdatedAt: first.updatedAt,
      },
    );
    await expect(
      saveProductSizing(p.id, teeChart(p), { expectedUpdatedAt: first.updatedAt }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reasonCode: 'sizing_stale' } });
    await expect(
      saveProductSizing(p.id, teeChart(p), { expectedUpdatedAt: null }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await getProductSizing(p.id))?.garmentType).toBe('SHIRT');
  });

  it('refuses a deleted or unknown product', async () => {
    const p = await seedProduct();
    await db.product.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
    await expect(saveProductSizing(p.id, teeChart(p))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      saveProductSizing('5e0f3a4e-9999-4b8e-9c1f-999999999999', { garmentType: 'T_SHIRT' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('deletes, and deleting a size from the product removes it from the chart', async () => {
    const p = await seedProduct();
    await saveProductSizing(p.id, teeChart(p));
    await db.optionValue.delete({ where: { id: p.sizes.L! } });
    expect((await getProductSizing(p.id))?.entries.map((e) => e.labelEn)).toEqual(['S', 'M']);
    expect(await deleteProductSizing(p.id)).toBe(true);
    expect(await deleteProductSizing(p.id)).toBe(false);
    expect(await db.sizeChartEntry.count()).toBe(0);
  });
});

describe('getStorefrontSizeChart', () => {
  it('shows a published product’s chart, only the columns it fills', async () => {
    const p = await seedProduct();
    await saveProductSizing(p.id, teeChart(p));
    const chart = await getStorefrontSizeChart(p.id);
    expect(chart?.columns).toEqual(['chestCm', 'shoulderCm', 'lengthCm']);
    expect(chart?.rows.map((r) => r.label.en)).toEqual(['S', 'M', 'L']);
  });

  it('shows nothing for a draft product or a product without sizes', async () => {
    const draft = await seedProduct('DRAFT');
    await saveProductSizing(draft.id, teeChart(draft));
    expect(await getStorefrontSizeChart(draft.id)).toBeNull();
    const bare = await seedProduct();
    await saveProductSizing(bare.id, { garmentType: 'T_SHIRT' });
    expect(await getStorefrontSizeChart(bare.id)).toBeNull();
  });
});

describe('recommendSizeForCustomer', () => {
  async function customerWith(chestCm: string | null) {
    counter += 1;
    const { customer } = await registerCustomer({
      email: `sizing-${counter}-${Date.now()}@example.com`,
      password: 'correct-horse-9',
      name: 'Shopper',
    });
    if (chestCm !== null) {
      await saveBodyProfile(customer.id, {
        gender: 'MALE',
        heightCm: '177',
        weightKg: '78',
        waistCm: '84',
        chestCm,
        shoulderCm: '45',
      });
    }
    return customer.id;
  }

  it('uses the customer’s own profile and the product’s chart', async () => {
    const p = await seedProduct();
    await saveProductSizing(p.id, teeChart(p));
    const small = await customerWith('96');
    const large = await customerWith('102');
    const a = await recommendSizeForCustomer(small, p.id);
    const b = await recommendSizeForCustomer(large, p.id);
    expect(a).toMatchObject({
      status: 'recommended',
      recommendation: { recommendedSizeId: p.sizes.M },
    });
    expect(b).toMatchObject({
      status: 'recommended',
      recommendation: { recommendedSizeId: p.sizes.L },
    });
  });

  it('a fit preference for this call changes the answer and saves nothing', async () => {
    const p = await seedProduct();
    await saveProductSizing(p.id, teeChart(p));
    const me = await customerWith('100');
    const slim = await recommendSizeForCustomer(me, p.id, { fitPreference: 'SLIM' });
    expect(slim).toMatchObject({
      recommendation: { recommendedSizeId: p.sizes.M, fitPreference: 'SLIM' },
    });
    const profile = await db.bodyProfile.findUnique({ where: { customerId: me } });
    expect(profile?.fitPreference).toBe('REGULAR');
  });

  it('says what is missing instead of guessing', async () => {
    const p = await seedProduct();
    await saveProductSizing(p.id, teeChart(p));
    expect(await recommendSizeForCustomer(await customerWith(null), p.id)).toEqual({
      status: 'no_profile',
    });

    const noChest = await customerWith('100');
    await db.bodyProfile.update({ where: { customerId: noChest }, data: { chestCm: null } });
    expect(await recommendSizeForCustomer(noChest, p.id)).toMatchObject({
      status: 'insufficient_data',
      missing: ['chestCm'],
    });
  });

  it('no chart, or an unpublished product → no_sizing', async () => {
    const me = await customerWith('100');
    const bare = await seedProduct();
    expect(await recommendSizeForCustomer(me, bare.id)).toEqual({ status: 'no_sizing' });
    const draft = await seedProduct('DRAFT');
    await saveProductSizing(draft.id, teeChart(draft));
    expect(await recommendSizeForCustomer(me, draft.id)).toEqual({ status: 'no_sizing' });
  });
});
