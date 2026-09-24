import { describe, expect, it } from 'vitest';

import { deriveBodyShape } from './body-shape.service';

describe('deriveBodyShape', () => {
  it('needs chest, waist and hip — without one it says nothing rather than guessing', () => {
    expect(deriveBodyShape({ chestCm: null, waistCm: 80, hipCm: 95 })).toBeNull();
    expect(deriveBodyShape({ chestCm: 95, waistCm: 80, hipCm: null })).toBeNull();
    expect(deriveBodyShape({ chestCm: 95, waistCm: null, hipCm: 95 })).toBeNull();
  });

  it('describes each proportion from the measurements alone', () => {
    // chest ≈ hip, waist well in
    expect(deriveBodyShape({ chestCm: 92, waistCm: 68, hipCm: 94 })).toBe('DEFINED_WAIST');
    // chest ≈ hip, waist close to both
    expect(deriveBodyShape({ chestCm: 100, waistCm: 88, hipCm: 98 })).toBe('STRAIGHT');
    // hip clearly the wider of the two
    expect(deriveBodyShape({ chestCm: 88, waistCm: 70, hipCm: 102 })).toBe('HIPS_WIDER');
    // chest clearly the wider of the two
    expect(deriveBodyShape({ chestCm: 110, waistCm: 80, hipCm: 95 })).toBe('CHEST_WIDER');
    // waist at or beyond both
    expect(deriveBodyShape({ chestCm: 104, waistCm: 108, hipCm: 106 })).toBe('WAIST_WIDEST');
  });

  it('puts the 5% chest/hip threshold exactly where it says', () => {
    // hip 5% over chest → wider hips; just under → treated as level
    expect(deriveBodyShape({ chestCm: 100, waistCm: 90, hipCm: 105 })).toBe('HIPS_WIDER');
    expect(deriveBodyShape({ chestCm: 100, waistCm: 90, hipCm: 104.9 })).toBe('STRAIGHT');
  });

  it('is a pure function of its input', () => {
    const input = { chestCm: 92, waistCm: 68, hipCm: 94 };
    expect(deriveBodyShape(input)).toBe(deriveBodyShape({ ...input }));
  });
});
