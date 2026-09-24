import { describe, expect, it } from 'vitest';

import {
  COMPLETION_ITEMS,
  computeProfileCompletion,
  type CompletionInput,
} from './profile-completion';

const EMPTY: CompletionInput = {
  gender: null,
  measurements: {},
  appearance: { skinTone: null, hairStyle: null, hairColor: null },
};

const MINIMUM: CompletionInput = {
  gender: 'FEMALE',
  measurements: { heightCm: 165, weightKg: 60, waistCm: 72 },
  appearance: { skinTone: null, hairStyle: null, hairColor: null },
};

describe('computeProfileCompletion', () => {
  it('weights add up to exactly 100', () => {
    expect(COMPLETION_ITEMS.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
  });

  it('no profile at all is 0%, with the required fields suggested first', () => {
    const completion = computeProfileCompletion(null);
    expect(completion.percent).toBe(0);
    expect(completion.requiredComplete).toBe(false);
    expect(completion.missing.slice(0, 4)).toEqual(['gender', 'heightCm', 'weightKg', 'waistCm']);
    expect(completion.nextStep).toBe('gender');
    expect(computeProfileCompletion(EMPTY)).toEqual(completion);
  });

  it('the minimum savable profile is 40%, and suggests the hip measurement next', () => {
    const completion = computeProfileCompletion(MINIMUM);
    expect(completion.percent).toBe(40);
    expect(completion.requiredComplete).toBe(true);
    expect(completion.sections.basic).toEqual({ done: 1, total: 1, complete: true });
    expect(completion.sections.measurements).toMatchObject({ done: 3, total: 9, complete: false });
    expect(completion.nextStep).toBe('hipCm');
  });

  it('every optional measurement and appearance choice adds its own weight', () => {
    const completion = computeProfileCompletion({
      ...MINIMUM,
      measurements: { ...MINIMUM.measurements, hipCm: 96, chestCm: 90 },
      appearance: { skinTone: 'MEDIUM', hairStyle: 'LONG', hairColor: null },
    });
    expect(completion.percent).toBe(40 + 7 + 7 + 9 + 8);
    expect(completion.nextStep).toBe('inseamCm');
    expect(completion.missing).toContain('hairColor');
  });

  it('covered hair needs no hair colour', () => {
    const completion = computeProfileCompletion({
      ...MINIMUM,
      appearance: { skinTone: 'DARK', hairStyle: 'COVERED', hairColor: null },
    });
    expect(completion.missing).not.toContain('hairColor');
    expect(completion.percent).toBe(40 + 9 + 8 + 8);
  });

  it('a complete profile is 100% with nothing left to suggest', () => {
    const completion = computeProfileCompletion({
      gender: 'PREFER_NOT_TO_SAY',
      measurements: {
        heightCm: 170,
        weightKg: 70,
        waistCm: 80,
        chestCm: 95,
        hipCm: 98,
        shoulderCm: 42,
        inseamCm: 78,
        sleeveLengthCm: 60,
        neckCm: 37,
      },
      appearance: { skinTone: 'LIGHT', hairStyle: 'CURLY', hairColor: 'RED' },
    });
    expect(completion.percent).toBe(100);
    expect(completion.missing).toEqual([]);
    expect(completion.nextStep).toBeNull();
    expect(Object.values(completion.sections).every((s) => s.complete)).toBe(true);
  });

  it('is deterministic', () => {
    expect(computeProfileCompletion(MINIMUM)).toEqual(computeProfileCompletion(MINIMUM));
  });
});
