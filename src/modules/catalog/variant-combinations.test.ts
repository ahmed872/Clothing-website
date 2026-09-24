import { describe, expect, it } from 'vitest';

import { cartesianProduct, matchVariantsToCombinations, generateSku } from './variant-combinations';
import type { ProductOptionInput, VariantInput } from './schemas';

const shoeOptions: ProductOptionInput[] = [
  {
    nameAr: 'اللون',
    nameEn: 'Color',
    values: [
      { valueAr: 'أسود', valueEn: 'Black' },
      { valueAr: 'أبيض', valueEn: 'White' },
    ],
  },
  {
    nameAr: 'المقاس',
    nameEn: 'Size',
    values: [
      { valueAr: '40', valueEn: '40' },
      { valueAr: '41', valueEn: '41' },
      { valueAr: '42', valueEn: '42' },
    ],
  },
];

function variant(sku: string, optionValues?: VariantInput['optionValues']): VariantInput {
  return { sku, priceMinor: 10000, optionValues };
}

describe('cartesianProduct', () => {
  it('produces one empty combination for no options (the default-variant case)', () => {
    expect(cartesianProduct([])).toEqual([[]]);
  });

  it('produces every Color x Size combination, in order', () => {
    const combos = cartesianProduct(shoeOptions);
    expect(combos).toHaveLength(6); // 2 colors x 3 sizes
    expect(combos[0]).toEqual([
      { optionNameEn: 'Color', valueEn: 'Black' },
      { optionNameEn: 'Size', valueEn: '40' },
    ]);
    expect(combos[5]).toEqual([
      { optionNameEn: 'Color', valueEn: 'White' },
      { optionNameEn: 'Size', valueEn: '42' },
    ]);
  });

  it('handles a single option (no combining needed)', () => {
    const combos = cartesianProduct([shoeOptions[0]!]);
    expect(combos).toEqual([
      [{ optionNameEn: 'Color', valueEn: 'Black' }],
      [{ optionNameEn: 'Color', valueEn: 'White' }],
    ]);
  });
});

describe('matchVariantsToCombinations', () => {
  it('accepts exactly one variant when there are no options', () => {
    const matched = matchVariantsToCombinations([], [variant('DEFAULT-1')]);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.combination).toEqual([]);
  });

  it('rejects zero or more than one variant when there are no options', () => {
    expect(() => matchVariantsToCombinations([], [])).toThrow();
    expect(() => matchVariantsToCombinations([], [variant('A'), variant('B')])).toThrow();
  });

  it('matches a full, correct set of variants to every combination', () => {
    const variants = cartesianProduct(shoeOptions).map((combo, i) => variant(`SKU-${i}`, combo));
    const matched = matchVariantsToCombinations(shoeOptions, variants);
    expect(matched).toHaveLength(6);
  });

  it('rejects a missing combination', () => {
    const variants = cartesianProduct(shoeOptions)
      .slice(0, 5)
      .map((combo, i) => variant(`SKU-${i}`, combo));
    expect(() => matchVariantsToCombinations(shoeOptions, variants)).toThrow();
  });

  it('rejects a duplicate combination', () => {
    const combo = cartesianProduct(shoeOptions)[0]!;
    const variants = [variant('A', combo), variant('B', combo)];
    expect(() => matchVariantsToCombinations(shoeOptions, variants)).toThrow();
  });

  it('rejects a variant whose optionValues do not name a real combination', () => {
    const variants = [
      variant('A', [
        { optionNameEn: 'Color', valueEn: 'Purple' }, // not a real value
        { optionNameEn: 'Size', valueEn: '40' },
      ]),
    ];
    expect(() => matchVariantsToCombinations(shoeOptions, variants)).toThrow();
  });

  it('matches regardless of the order optionValues are listed in', () => {
    const combo = cartesianProduct(shoeOptions)[0]!; // [Color=Black, Size=40]
    const reversed = [...combo].reverse(); // [Size=40, Color=Black]
    const matched = matchVariantsToCombinations(
      shoeOptions,
      cartesianProduct(shoeOptions).map((c, i) =>
        i === 0 ? variant('SKU-0', reversed) : variant(`SKU-${i}`, c),
      ),
    );
    expect(matched).toHaveLength(6);
  });
});

describe('generateSku', () => {
  it('joins, uppercases and sanitises parts', () => {
    expect(generateSku('Mercedes-Benz', 'S 500', 2024)).toBe('MERCEDES-BENZ-S-500-2024');
  });

  it('drops empty parts', () => {
    expect(generateSku('BMW', '', '740i')).toBe('BMW-740I');
  });
});
