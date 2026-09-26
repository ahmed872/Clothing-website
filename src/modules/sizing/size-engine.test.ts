import { describe, expect, it } from 'vitest';

import type { SizingProfile } from '@/modules/body-profile';

import type { GarmentType } from './garment-types';
import { recommendSize, RuleBasedSizeRecommendationService } from './size-engine';
import type { SizeChartRow, SizeRecommendationResult } from './size-recommendation';
import { GARMENT_RULES } from './sizing-rules';

type ProfileOverrides = Omit<Partial<SizingProfile>, 'optional'> & {
  optional?: Partial<SizingProfile['optional']>;
};

function profile(overrides: ProfileOverrides = {}): SizingProfile {
  const { optional, ...rest } = overrides;
  return {
    gender: 'MALE',
    heightCm: 177,
    waistCm: 84,
    weightKg: 78,
    bodyShape: null,
    fitPreference: 'REGULAR',
    ...rest,
    optional: {
      chestCm: 100,
      hipCm: null,
      shoulderCm: 45,
      inseamCm: null,
      sleeveLengthCm: null,
      neckCm: null,
      ...optional,
    },
  };
}

function rows(sizes: [string, SizeChartRow['measurements']][]): SizeChartRow[] {
  return sizes.map(([label, measurements]) => ({
    sizeId: `size-${label}`,
    label: { ar: label, en: label },
    measurements,
  }));
}

const TEE = rows([
  ['S', { chestCm: 101, shoulderCm: 42, lengthCm: 68 }],
  ['M', { chestCm: 107, shoulderCm: 44, lengthCm: 70 }],
  ['L', { chestCm: 113, shoulderCm: 46, lengthCm: 72 }],
  ['XL', { chestCm: 119, shoulderCm: 48, lengthCm: 74 }],
]);

function recommended(result: SizeRecommendationResult) {
  expect(result.status).toBe('recommended');
  if (result.status !== 'recommended') throw new Error('not recommended');
  return result.recommendation;
}

function tee(p: SizingProfile, garmentType: GarmentType = 'T_SHIRT', chart = TEE) {
  return recommendSize({ profile: p, garmentType, sizeChart: chart });
}

describe('an exact match', () => {
  it('is recommended with high confidence and says what matched', () => {
    // Chest 97 + regular ease 10 = 107 (M exactly); shoulder within tolerance.
    const r = recommended(tee(profile({ optional: { chestCm: 97 } })));
    expect(r.recommendedSizeId).toBe('size-M');
    expect(r.confidence).toBe('HIGH');
    expect(r.score).toBe(86);
    expect(r.reasons).toEqual([
      { code: 'measurement', measurement: 'chestCm', fit: 'fits' },
      { code: 'measurement', measurement: 'shoulderCm', fit: 'fits' },
      { code: 'fit_preference', fitPreference: 'REGULAR' },
    ]);
    expect(r.alternatives).toEqual([{ sizeId: 'size-L', direction: 'larger', score: 67 }]);
  });

  it('scores every size, in chart order, for a fitting room to show', () => {
    const r = recommended(tee(profile({ optional: { chestCm: 97 } })));
    expect(r.sizes.map((s) => [s.sizeId, s.score])).toEqual([
      ['size-S', 31],
      ['size-M', 86],
      ['size-L', 67],
      ['size-XL', 22],
    ]);
    expect(r.sizes[0]!.comparisons).toEqual([
      { measurement: 'chestCm', fit: 'snug' },
      { measurement: 'shoulderCm', fit: 'snug' },
    ]);
  });
});

describe('fit preference changes the room aimed for, never the body', () => {
  // Chest 100, shoulder 45 against the same tee chart.
  it.each([
    ['SLIM', 'size-M'],
    ['REGULAR', 'size-L'],
    ['RELAXED', 'size-XL'],
  ] as const)('%s → %s', (fitPreference, size) => {
    const r = recommended(tee(profile({ fitPreference })));
    expect(r.recommendedSizeId).toBe(size);
    expect(r.fitPreference).toBe(fitPreference);
    expect(r.reasons).toContainEqual({ code: 'fit_preference', fitPreference });
  });

  it('a requested preference overrides the saved one for this call only', () => {
    const saved = profile({ fitPreference: 'REGULAR' });
    const slim = recommendSize({
      profile: saved,
      garmentType: 'T_SHIRT',
      sizeChart: TEE,
      fitPreference: 'SLIM',
    });
    expect(recommended(slim).recommendedSizeId).toBe('size-M');
    expect(saved.fitPreference).toBe('REGULAR');
  });
});

describe('near matches and between sizes', () => {
  it('a near match is still recommended, with lower confidence', () => {
    // Chest 100 → ideal 110: L is 3 cm over — within tolerance, not exact.
    // Without a shoulder measurement only 2/3 of the tee's weight is
    // covered, which caps confidence below HIGH and asks for it.
    const r = recommended(tee(profile({ optional: { chestCm: 100, shoulderCm: null } })));
    expect(r.recommendedSizeId).toBe('size-L');
    expect(r.score).toBe(75);
    expect(r.confidence).toBe('MEDIUM');
    expect(r.reasons[0]).toEqual({ code: 'measurement', measurement: 'chestCm', fit: 'fits' });
    expect(r.reasons).toContainEqual({ code: 'limited_measurements', missing: ['shoulderCm'] });
  });

  it('between two sizes: says so, names the other, and is not HIGH', () => {
    // Chest 99.5 → ideal 109.5: M is 2.5 short, L 3.5 over — nearly equal.
    const r = recommended(tee(profile({ optional: { chestCm: 99.5, shoulderCm: null } })));
    expect(r.recommendedSizeId).toBe('size-M');
    expect(r.confidence).toBe('MEDIUM');
    expect(r.reasons).toContainEqual({ code: 'between_sizes', otherSizeId: 'size-L' });
    expect(r.alternatives[0]).toMatchObject({ sizeId: 'size-L', direction: 'larger' });
  });

  it('an exact tie goes to the larger size — or the smaller for a slim fit', () => {
    const twins = rows([
      ['A', { chestCm: 110 }],
      ['B', { chestCm: 110 }],
    ]);
    const p = profile({ optional: { shoulderCm: null } });
    expect(recommended(tee(p, 'T_SHIRT', twins)).recommendedSizeId).toBe('size-B');
    expect(
      recommended(tee({ ...p, fitPreference: 'SLIM' }, 'T_SHIRT', twins)).recommendedSizeId,
    ).toBe('size-A');
  });
});

describe('missing data is an answer, never a guess', () => {
  it('no chest measurement → insufficient data for a T-shirt, naming chest', () => {
    expect(tee(profile({ optional: { chestCm: null } }))).toEqual({
      status: 'insufficient_data',
      missing: ['chestCm'],
    });
  });

  it('an optional measurement missing lowers coverage and asks for it', () => {
    const dress = rows([
      ['S', { waistCm: 76, chestCm: 92, hipCm: 98 }],
      ['M', { waistCm: 82, chestCm: 98, hipCm: 104 }],
      ['L', { waistCm: 88, chestCm: 104, hipCm: 110 }],
    ]);
    const p = profile({
      gender: 'FEMALE',
      waistCm: 74,
      optional: { chestCm: null, hipCm: null, shoulderCm: null },
    });
    const r = recommended(recommendSize({ profile: p, garmentType: 'DRESS', sizeChart: dress }));
    expect(r.recommendedSizeId).toBe('size-M');
    expect(r.confidence).not.toBe('HIGH');
    expect(r.reasons).toContainEqual({
      code: 'limited_measurements',
      missing: ['chestCm', 'hipCm', 'shoulderCm'],
    });
  });

  it('no chart → no_size_data', () => {
    expect(tee(profile(), 'T_SHIRT', [])).toEqual({ status: 'no_size_data', reason: 'no_chart' });
  });

  it('a chart missing a required measurement in any size → no_size_data', () => {
    const broken = rows([
      ['S', { chestCm: 101 }],
      ['M', { shoulderCm: 44 }],
    ]);
    expect(tee(profile(), 'T_SHIRT', broken)).toEqual({
      status: 'no_size_data',
      reason: 'chart_incomplete',
    });
  });
});

describe('outside the chart', () => {
  it('measurements above the largest size → no_matching_size, not "XL"', () => {
    expect(tee(profile({ optional: { chestCm: 130 } }))).toEqual({
      status: 'no_matching_size',
      direction: 'above',
      fitPreference: 'REGULAR',
    });
  });

  it('measurements below the smallest size → below', () => {
    expect(tee(profile({ optional: { chestCm: 70, shoulderCm: 34 } }))).toEqual({
      status: 'no_matching_size',
      direction: 'below',
      fitPreference: 'REGULAR',
    });
  });

  it('an adult profile against a children’s chart → above', () => {
    const kids = rows([
      ['2-3Y', { chestCm: 56 }],
      ['4-5Y', { chestCm: 60 }],
      ['6-7Y', { chestCm: 64 }],
    ]);
    expect(tee(profile(), 'T_SHIRT', kids)).toMatchObject({
      status: 'no_matching_size',
      direction: 'above',
      fitPreference: 'REGULAR',
    });
  });
});

describe('only one size', () => {
  it('is recommended when it fits, with no alternatives', () => {
    const one = rows([['One size', { chestCm: 110, shoulderCm: 46 }]]);
    const r = recommended(tee(profile(), 'T_SHIRT', one));
    expect(r.recommendedSizeId).toBe('size-One size');
    expect(r.alternatives).toEqual([]);
  });

  it('is not recommended when it does not', () => {
    const one = rows([['One size', { chestCm: 90, shoulderCm: 40 }]]);
    expect(tee(profile(), 'T_SHIRT', one).status).toBe('no_matching_size');
  });
});

describe('garment types size by different measurements', () => {
  it('jeans size by waist (required), hip and inseam', () => {
    const jeans = rows([
      ['30', { waistCm: 78, hipCm: 94, inseamCm: 81 }],
      ['32', { waistCm: 83, hipCm: 99, inseamCm: 82 }],
      ['34', { waistCm: 88, hipCm: 104, inseamCm: 83 }],
    ]);
    const p = profile({ waistCm: 81, optional: { chestCm: null, hipCm: 95, inseamCm: 82 } });
    const r = recommended(recommendSize({ profile: p, garmentType: 'JEANS', sizeChart: jeans }));
    expect(r.recommendedSizeId).toBe('size-32');
    expect(r.reasons.slice(0, 3)).toEqual([
      { code: 'measurement', measurement: 'waistCm', fit: 'fits' },
      { code: 'measurement', measurement: 'hipCm', fit: 'fits' },
      { code: 'measurement', measurement: 'inseamCm', fit: 'fits' },
    ]);
  });

  it('a thobe sizes by length, estimated from height, and says so', () => {
    // Size numbers are the thobe's length in inches.
    const thobe = rows([
      ['52', { lengthCm: 132.1, chestCm: 108 }],
      ['54', { lengthCm: 137.2, chestCm: 112 }],
      ['56', { lengthCm: 142.2, chestCm: 116 }],
      ['58', { lengthCm: 147.3, chestCm: 120 }],
    ]);
    const tall = recommended(
      recommendSize({
        profile: profile({ heightCm: 178 }),
        garmentType: 'THOBE',
        sizeChart: thobe,
      }),
    );
    expect(tall.recommendedSizeId).toBe('size-56');
    expect(tall.reasons).toContainEqual({ code: 'length_from_height' });

    const shorter = recommended(
      recommendSize({
        profile: profile({ heightCm: 166 }),
        garmentType: 'THOBE',
        sizeChart: thobe,
      }),
    );
    expect(shorter.recommendedSizeId).toBe('size-52');
  });

  it('the same body and chart numbers can mean different sizes for different garments', () => {
    const chart = rows([
      ['S', { chestCm: 104 }],
      ['M', { chestCm: 110 }],
      ['L', { chestCm: 116 }],
    ]);
    const p = profile({ optional: { shoulderCm: null } });
    // A tee wants 10 cm of chest ease, a hoodie 16.
    expect(recommended(tee(p, 'T_SHIRT', chart)).recommendedSizeId).toBe('size-M');
    expect(recommended(tee(p, 'HOODIE', chart)).recommendedSizeId).toBe('size-L');
  });

  it('different products with different charts give different sizes for one body', () => {
    const roomy = rows([
      ['S', { chestCm: 112 }],
      ['M', { chestCm: 118 }],
    ]);
    const p = profile({ optional: { shoulderCm: null } });
    expect(recommended(tee(p, 'T_SHIRT', TEE)).recommendedSizeId).toBe('size-L');
    expect(recommended(tee(p, 'T_SHIRT', roomy)).recommendedSizeId).toBe('size-S');
  });

  it('every garment type has at least one required measurement and sane rules', () => {
    for (const [garment, rules] of Object.entries(GARMENT_RULES)) {
      const scored = Object.values(rules.scored);
      expect(
        scored.some((r) => r.required),
        garment,
      ).toBe(true);
      for (const r of scored) {
        expect(r.weight, garment).toBeGreaterThan(0);
        expect(r.tolerance, garment).toBeGreaterThan(0);
        expect(r.ease.SLIM, garment).toBeLessThanOrEqual(r.ease.REGULAR);
        expect(r.ease.REGULAR, garment).toBeLessThanOrEqual(r.ease.RELAXED);
      }
    }
  });
});

describe('what it does not use', () => {
  it('is deterministic — the same input always gives the same answer', () => {
    const p = profile();
    expect(tee(p)).toEqual(tee(p));
    expect(JSON.stringify(tee(p))).toBe(JSON.stringify(tee(structuredClone(p))));
  });

  it('weight and gender never change the answer', () => {
    const base = tee(profile());
    expect(tee(profile({ weightKg: 140 }))).toEqual(base);
    expect(tee(profile({ gender: 'FEMALE' }))).toEqual(base);
    expect(tee(profile({ bodyShape: 'WAIST_WIDEST' }))).toEqual(base);
  });

  it('reasons carry codes only — never a body measurement value', () => {
    const r = recommended(tee(profile({ optional: { chestCm: 97.3 } })));
    expect(JSON.stringify(r)).not.toContain('97.3');
  });

  it('the service is the engine, behind the async contract', async () => {
    const service = new RuleBasedSizeRecommendationService();
    const request = { profile: profile(), garmentType: 'T_SHIRT' as const, sizeChart: TEE };
    await expect(service.recommend(request)).resolves.toEqual(recommendSize(request));
  });
});
