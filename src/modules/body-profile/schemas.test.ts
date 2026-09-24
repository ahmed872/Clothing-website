import { describe, expect, it } from 'vitest';

import { checkMeasurement, parseMeasurementInput } from './measurement-input';
import { MEASUREMENT_BOUNDS, MEASUREMENT_KEYS } from './options';
import {
  avatarConfigurationInputSchema,
  bodyProfileInputSchema,
  fieldErrorsFromIssues,
} from './schemas';

const VALID = {
  gender: 'MALE',
  heightCm: '177',
  weightKg: '82',
  waistCm: '88',
} as const;

function errorsFor(input: unknown) {
  const result = bodyProfileInputSchema.safeParse(input);
  expect(result.success).toBe(false);
  return fieldErrorsFromIssues(result.error!.issues);
}

describe('parseMeasurementInput — what a customer can type', () => {
  it('reads plain numbers and one-or-two-decimal strings, stored at one decimal', () => {
    expect(parseMeasurementInput('177')).toBe(177);
    expect(parseMeasurementInput(' 88.5 ')).toBe(88.5);
    expect(parseMeasurementInput('88.25')).toBe(88.3);
    expect(parseMeasurementInput('88.24')).toBe(88.2);
    expect(parseMeasurementInput(82)).toBe(82);
    expect(parseMeasurementInput(82.46)).toBe(82.5);
  });

  it('reads Arabic-Indic and Persian digits and every decimal separator', () => {
    expect(parseMeasurementInput('١٧٧')).toBe(177);
    expect(parseMeasurementInput('٨٨٫٥')).toBe(88.5);
    expect(parseMeasurementInput('۸۸٫۵')).toBe(88.5);
    expect(parseMeasurementInput('88,5')).toBe(88.5);
  });

  it('treats empty as "not entered", not as zero', () => {
    expect(parseMeasurementInput('')).toBeNull();
    expect(parseMeasurementInput('   ')).toBeNull();
    expect(parseMeasurementInput(undefined)).toBeNull();
    expect(parseMeasurementInput(null)).toBeNull();
  });

  it('refuses malformed values instead of guessing at them', () => {
    for (const raw of [
      'abc',
      '1.2.3',
      '-5',
      '+5',
      '1e2',
      '88.555',
      '1777',
      '88 cm',
      '.5',
      '5.',
      'Infinity',
      'NaN',
      '0x1A',
    ]) {
      expect(parseMeasurementInput(raw), raw).toBe('invalid');
    }
    expect(parseMeasurementInput(Number.NaN)).toBe('invalid');
    expect(parseMeasurementInput(Number.POSITIVE_INFINITY)).toBe('invalid');
    expect(parseMeasurementInput(true)).toBe('invalid');
    expect(parseMeasurementInput({})).toBe('invalid');
  });
});

describe('checkMeasurement — realistic bounds, inclusive', () => {
  it('accepts every bound itself and rejects just past it', () => {
    for (const key of MEASUREMENT_KEYS) {
      const { min, max } = MEASUREMENT_BOUNDS[key];
      expect(checkMeasurement(key, min).problem, `${key} min`).toBeNull();
      expect(checkMeasurement(key, max).problem, `${key} max`).toBeNull();
      expect(checkMeasurement(key, min - 0.1).problem, `${key} below`).toBe('too_small');
      expect(checkMeasurement(key, max + 0.1).problem, `${key} above`).toBe('too_large');
    }
  });

  it('rejects zero and negative values', () => {
    expect(checkMeasurement('heightCm', 0).problem).toBe('too_small');
    expect(checkMeasurement('weightKg', -70).problem).toBe('too_small');
  });

  it('catches the classic typo of metres for centimetres', () => {
    expect(checkMeasurement('heightCm', '1.77').problem).toBe('too_small');
  });
});

describe('bodyProfileInputSchema', () => {
  it('accepts the minimum profile — gender and the three required measurements', () => {
    const data = bodyProfileInputSchema.parse(VALID);
    expect(data).toMatchObject({ gender: 'MALE', heightCm: 177, weightKg: 82, waistCm: 88 });
    expect(data.chestCm).toBeNull();
    expect(data.neckCm).toBeNull();
    expect(data.avatar).toEqual({
      skinTone: null,
      hairStyle: null,
      hairColor: null,
      facialHair: null,
      wearsGlasses: false,
      glassesStyle: null,
      glassesFrameColor: null,
    });
  });

  it('names every missing required field', () => {
    expect(errorsFor({})).toEqual({
      gender: 'required',
      heightCm: 'required',
      weightKg: 'required',
      waistCm: 'required',
    });
  });

  it('reports range and format problems per field', () => {
    expect(
      errorsFor({ ...VALID, heightCm: '0', weightKg: '999', waistCm: 'abc', hipCm: '-1' }),
    ).toEqual({
      heightCm: 'too_small',
      weightKg: 'too_large',
      waistCm: 'invalid_number',
      hipCm: 'invalid_number',
    });
  });

  it('treats an empty choice as missing, not as a wrong option', () => {
    expect(errorsFor({ ...VALID, gender: '' })).toEqual({ gender: 'required' });
  });

  it('rejects a value outside every closed list', () => {
    expect(errorsFor({ ...VALID, gender: 'ROBOT' })).toEqual({ gender: 'invalid_option' });
    expect(errorsFor({ ...VALID, avatar: { skinTone: 'GREEN' } })).toEqual({
      skinTone: 'invalid_option',
    });
    expect(errorsFor({ ...VALID, avatar: { hairStyle: 'shaved' } })).toEqual({
      hairStyle: 'invalid_option',
    });
    expect(errorsFor({ ...VALID, avatar: { wearsGlasses: 'yes' } })).toEqual({
      wearsGlasses: 'invalid_option',
    });
  });

  it('refuses any field it does not define — no mass assignment', () => {
    for (const extra of [
      { customerId: '5e0f3a4e-1111-4b8e-9c1f-111111111111' },
      { id: '5e0f3a4e-1111-4b8e-9c1f-111111111111' },
      { bodyShape: 'STRAIGHT' },
      { createdAt: '2020-01-01' },
    ]) {
      expect(errorsFor({ ...VALID, ...extra }), JSON.stringify(extra)).toEqual({
        form: 'unknown_field',
      });
    }
    expect(errorsFor({ ...VALID, avatar: { bodyProfileId: 'x' } })).toEqual({
      form: 'unknown_field',
    });
  });

  it('treats an untouched appearance choice ("") as not chosen', () => {
    const data = bodyProfileInputSchema.parse({
      ...VALID,
      avatar: { skinTone: '', hairStyle: 'COVERED', hairColor: '' },
    });
    expect(data.avatar).toMatchObject({ skinTone: null, hairStyle: 'COVERED', hairColor: null });
  });
});

describe('avatarConfigurationInputSchema — glasses', () => {
  it('keeps glasses details while glasses are on', () => {
    expect(
      avatarConfigurationInputSchema.parse({
        wearsGlasses: true,
        glassesStyle: 'ROUND',
        glassesFrameColor: 'GOLD',
      }),
    ).toMatchObject({ wearsGlasses: true, glassesStyle: 'ROUND', glassesFrameColor: 'GOLD' });
  });

  it('clears them when glasses are off, rather than storing contradictions', () => {
    expect(
      avatarConfigurationInputSchema.parse({
        wearsGlasses: false,
        glassesStyle: 'ROUND',
        glassesFrameColor: 'GOLD',
      }),
    ).toMatchObject({ wearsGlasses: false, glassesStyle: null, glassesFrameColor: null });
  });

  it('still validates a glasses style even when it will be cleared', () => {
    expect(
      avatarConfigurationInputSchema.safeParse({ wearsGlasses: false, glassesStyle: 'MONOCLE' })
        .success,
    ).toBe(false);
  });
});
