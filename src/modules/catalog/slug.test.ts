import { describe, expect, it } from 'vitest';

import { slugify, slugSchema, ensureUniqueSlug } from './slug';

describe('slugify', () => {
  it('lowercases and hyphenates Latin text', () => {
    expect(slugify('Mercedes-Benz S-Class')).toBe('mercedes-benz-s-class');
  });

  it('preserves Arabic text, hyphenating whitespace', () => {
    expect(slugify('سيارات فاخرة')).toBe('سيارات-فاخرة');
  });

  it('strips punctuation that is neither a letter nor a number', () => {
    expect(slugify('BMW 7-Series (2024)!')).toBe('bmw-7-series-2024');
  });

  it('collapses repeated separators and trims leading/trailing hyphens', () => {
    expect(slugify('  --Range   Rover--  ')).toBe('range-rover');
  });
});

describe('slugSchema', () => {
  it('accepts a lowercase, hyphenated Latin slug', () => {
    expect(slugSchema.safeParse('range-rover-2026').success).toBe(true);
  });

  it('accepts an Arabic slug', () => {
    expect(slugSchema.safeParse('سيارات-فاخرة').success).toBe(true);
  });

  it('rejects spaces', () => {
    expect(slugSchema.safeParse('range rover').success).toBe(false);
  });

  it('rejects uppercase', () => {
    expect(slugSchema.safeParse('Range-Rover').success).toBe(false);
  });

  it('rejects a leading or trailing hyphen', () => {
    expect(slugSchema.safeParse('-range-rover').success).toBe(false);
    expect(slugSchema.safeParse('range-rover-').success).toBe(false);
  });

  it('rejects a double hyphen', () => {
    expect(slugSchema.safeParse('range--rover').success).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(slugSchema.safeParse('').success).toBe(false);
  });
});

describe('ensureUniqueSlug', () => {
  it('returns the plain slug when free', async () => {
    const slug = await ensureUniqueSlug('Range Rover', async () => false);
    expect(slug).toBe('range-rover');
  });

  it('appends -2, -3, ... until a free candidate is found', async () => {
    const taken = new Set(['range-rover', 'range-rover-2', 'range-rover-3']);
    const slug = await ensureUniqueSlug('Range Rover', async (candidate) => taken.has(candidate));
    expect(slug).toBe('range-rover-4');
  });
});
