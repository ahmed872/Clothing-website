import { describe, expect, it } from 'vitest';

import { availableValuesForOption, findMatchingVariant } from './variant-selection';

const variants = [
  { id: 'v-black-40', optionValueIds: ['black', '40'] },
  { id: 'v-black-41', optionValueIds: ['black', '41'] },
  { id: 'v-white-40', optionValueIds: ['white', '40'] },
];

describe('findMatchingVariant', () => {
  it('finds the variant matching the full selection, regardless of key order', () => {
    expect(findMatchingVariant(variants, { size: '40', color: 'black' })?.id).toBe('v-black-40');
  });

  it('returns undefined for a combination that does not exist', () => {
    expect(findMatchingVariant(variants, { color: 'white', size: '41' })).toBeUndefined();
  });

  it('returns undefined for a partial selection', () => {
    expect(findMatchingVariant(variants, { color: 'black' })).toBeUndefined();
  });

  it('works for a single-option (no-variant-matrix) product', () => {
    const single = [{ id: 'only', optionValueIds: [] }];
    expect(findMatchingVariant(single, {})?.id).toBe('only');
  });
});

describe('availableValuesForOption', () => {
  it('reports every size available once black is chosen', () => {
    const available = availableValuesForOption(variants, 'size', ['40', '41'], { color: 'black' });
    expect([...available].sort()).toEqual(['40', '41']);
  });

  it('reports only 40 once white is chosen (41/white does not exist)', () => {
    const available = availableValuesForOption(variants, 'size', ['40', '41'], { color: 'white' });
    expect([...available]).toEqual(['40']);
  });

  it('reports every colour with no other selection made yet', () => {
    const available = availableValuesForOption(variants, 'color', ['black', 'white'], {});
    expect([...available].sort()).toEqual(['black', 'white']);
  });
});
