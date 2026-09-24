import { describe, expect, it } from 'vitest';

import type { BodyProfileView } from './body-profile.service';
import { toSizingProfile } from './size-recommendation';

const PROFILE: BodyProfileView = {
  gender: 'MALE',
  measurements: {
    heightCm: 177,
    weightKg: 82,
    waistCm: 88,
    chestCm: 100,
    hipCm: 98,
    shoulderCm: null,
    inseamCm: 81,
    sleeveLengthCm: null,
    neckCm: null,
  },
  bodyShape: 'STRAIGHT',
  avatar: {
    skinTone: 'MEDIUM',
    hairStyle: 'SHORT',
    hairColor: 'BLACK',
    facialHair: 'SHORT_BEARD',
    wearsGlasses: true,
    glassesStyle: 'ROUND',
    glassesFrameColor: 'BLACK',
  },
  updatedAt: new Date('2026-09-24T10:00:00.000Z'),
};

describe('toSizingProfile — the size engine contract', () => {
  it('carries the measurements, with the optional ones kept apart', () => {
    expect(toSizingProfile(PROFILE)).toEqual({
      gender: 'MALE',
      heightCm: 177,
      waistCm: 88,
      weightKg: 82,
      bodyShape: 'STRAIGHT',
      optional: {
        chestCm: 100,
        hipCm: 98,
        shoulderCm: null,
        inseamCm: 81,
        sleeveLengthCm: null,
        neckCm: null,
      },
    });
  });

  it('never hands appearance data or timestamps to sizing', () => {
    const sizing = toSizingProfile(PROFILE) as unknown as Record<string, unknown>;
    expect(sizing).not.toHaveProperty('avatar');
    expect(sizing).not.toHaveProperty('updatedAt');
    expect(JSON.stringify(sizing)).not.toContain('SHORT_BEARD');
  });
});
