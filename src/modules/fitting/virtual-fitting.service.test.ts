import { describe, expect, it } from 'vitest';

import type { SizingProfile } from '@/modules/body-profile';
import { resolveGarmentStyle, type SizeChartRow } from '@/modules/sizing';

import { virtualFittingService, type FittingProduct } from './virtual-fitting.service';

/** A swatch value — data here, not a colour this code paints with. */
const swatch = (digits: string) => `#${digits}`;

const profile = (chestCm: number | null): SizingProfile => ({
  gender: 'MALE',
  heightCm: 177,
  waistCm: 84,
  weightKg: 78,
  bodyShape: null,
  fitPreference: 'REGULAR',
  optional: {
    chestCm,
    hipCm: null,
    shoulderCm: 45,
    inseamCm: null,
    sleeveLengthCm: null,
    neckCm: null,
  },
});

const chart: SizeChartRow[] = [
  ['S', 101, 42],
  ['M', 107, 44],
  ['L', 113, 46],
  ['XL', 119, 48],
].map(([label, chestCm, shoulderCm]) => ({
  sizeId: `size-${label}`,
  label: { ar: String(label), en: String(label) },
  measurements: { chestCm: Number(chestCm), shoulderCm: Number(shoulderCm), lengthCm: 70 },
}));

const tee: FittingProduct = {
  productId: 'p1',
  garmentType: 'T_SHIRT',
  style: resolveGarmentStyle('T_SHIRT'),
  chart,
};
const black = {
  valueId: 'c-black',
  label: { ar: 'أسود', en: 'Black' },
  swatchHex: swatch('1D1D20'),
};

describe('VirtualFittingService', () => {
  it('fits the chosen size, and says where it stands against the recommendation', () => {
    const recommended = virtualFittingService.fit({
      profile: profile(97),
      product: tee,
      sizeId: 'size-M',
      color: black,
    });
    expect(recommended.recommendation).toMatchObject({ status: 'recommended', sizeId: 'size-M' });
    expect(recommended.relation).toEqual({ kind: 'recommended' });
    expect(recommended.fit?.areas).toContainEqual({ measurement: 'chestCm', fit: 'fits' });

    const smaller = virtualFittingService.fit({
      profile: profile(97),
      product: tee,
      sizeId: 'size-S',
      color: black,
    });
    expect(smaller.relation).toEqual({ kind: 'smaller', steps: 1 });
    expect(smaller.fit?.areas).toContainEqual({ measurement: 'chestCm', fit: 'snug' });

    const muchLarger = virtualFittingService.fit({
      profile: profile(97),
      product: tee,
      sizeId: 'size-XL',
      color: null,
    });
    expect(muchLarger.relation).toEqual({ kind: 'larger', steps: 2 });
    expect(muchLarger.color).toBeNull();
  });

  it('returns every size at once, smallest first, with its own measurements', () => {
    const all = virtualFittingService.fitAllSizes({
      profile: profile(97),
      product: tee,
      color: black,
    });
    expect(all.map((r) => [r.size.label.en, r.size.index, r.size.measurements.chestCm])).toEqual([
      ['S', 0, 101],
      ['M', 1, 107],
      ['L', 2, 113],
      ['XL', 3, 119],
    ]);
    expect(new Set(all.map((r) => r.layerKind))).toEqual(new Set(['top']));
    expect(all[0]!.style).toEqual({
      sleeveLength: 'SHORT',
      neckline: 'CREW',
      length: 'HIP',
      pattern: 'SOLID',
    });
  });

  it('never invents a fit when a measurement is missing — the garment is still shown', () => {
    const result = virtualFittingService.fit({
      profile: profile(null),
      product: tee,
      sizeId: 'size-L',
      color: black,
    });
    expect(result.recommendation).toEqual({ status: 'insufficient_data', missing: ['chestCm'] });
    expect(result.relation).toEqual({ kind: 'unknown' });
    expect(result.fit).toBeNull();
    expect(result.size.measurements.chestCm).toBe(113);
  });

  it('a fit to try moves the recommendation, never the chosen size', () => {
    const relaxed = virtualFittingService.fit({
      profile: profile(97),
      product: tee,
      sizeId: 'size-M',
      color: black,
      fitPreference: 'RELAXED',
    });
    expect(relaxed.size.sizeId).toBe('size-M');
    expect(relaxed.recommendation).toMatchObject({ sizeId: 'size-XL', fitPreference: 'RELAXED' });
    expect(relaxed.relation).toEqual({ kind: 'smaller', steps: 2 });
  });

  it('full-length garments are one layer from the shoulders down', () => {
    const [thobe] = virtualFittingService.fitAllSizes({
      profile: profile(100),
      product: {
        productId: 'p2',
        garmentType: 'THOBE',
        style: resolveGarmentStyle('THOBE', { garmentLength: null }),
        chart: [
          { sizeId: 's56', label: { ar: '56', en: '56' }, measurements: { lengthCm: 142.2 } },
        ],
      },
      color: null,
    });
    expect(thobe).toMatchObject({
      layerKind: 'full',
      style: { length: 'ANKLE', neckline: 'BAND' },
    });
  });

  it('refuses a size that is not the product’s, rather than guessing', () => {
    expect(() =>
      virtualFittingService.fit({
        profile: profile(97),
        product: tee,
        sizeId: 'nope',
        color: null,
      }),
    ).toThrow(RangeError);
  });

  it('is deterministic', () => {
    const input = { profile: profile(99.5), product: tee, color: black };
    expect(virtualFittingService.fitAllSizes(input)).toEqual(
      virtualFittingService.fitAllSizes(input),
    );
  });
});
