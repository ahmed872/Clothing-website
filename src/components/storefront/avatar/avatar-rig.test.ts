import { describe, expect, it } from 'vitest';

import { NEUTRAL_APPEARANCE, type AvatarRenderInput } from '@/lib/avatar/avatar-model';
import { AVATAR_VIEWBOX, RIG_PX_PER_CM, computeAvatarRig } from './avatar-rig';

function input(measurements: AvatarRenderInput['measurements']): AvatarRenderInput {
  return { measurements, appearance: NEUTRAL_APPEARANCE };
}

const BASE = { heightCm: 177, weightKg: 78, waistCm: 84 };

describe('computeAvatarRig — proportions come from the measurements', () => {
  it('is deterministic: the same profile gives the same rig', () => {
    const a = computeAvatarRig(input({ ...BASE, chestCm: 100, inseamCm: 81 }));
    const b = computeAvatarRig(input({ ...BASE, chestCm: 100, inseamCm: 81 }));
    expect(a).toEqual(b);
  });

  it('height sets the scale: every figure stands on the same floor, taller is taller', () => {
    const short = computeAvatarRig(input({ ...BASE, heightCm: 158 }));
    const tall = computeAvatarRig(input({ ...BASE, heightCm: 192 }));
    expect(short.floor).toBe(AVATAR_VIEWBOX.floorY);
    expect(tall.floor).toBe(AVATAR_VIEWBOX.floorY);
    expect(short.floor - short.top).toBeCloseTo(158 * RIG_PX_PER_CM, 1);
    expect(tall.floor - tall.top).toBeCloseTo(192 * RIG_PX_PER_CM, 1);
    expect(tall.y.shoulder).toBeLessThan(short.y.shoulder);
  });

  it('each girth widens exactly its own part of the torso', () => {
    const base = computeAvatarRig(input({ ...BASE, chestCm: 96, hipCm: 98 }));
    const widerWaist = computeAvatarRig(input({ ...BASE, waistCm: 104, chestCm: 96, hipCm: 98 }));
    expect(widerWaist.half.waist).toBeGreaterThan(base.half.waist);
    expect(widerWaist.half.chest).toBe(base.half.chest);
    expect(widerWaist.half.hip).toBe(base.half.hip);

    const widerHip = computeAvatarRig(input({ ...BASE, chestCm: 96, hipCm: 118 }));
    expect(widerHip.half.hip).toBeGreaterThan(base.half.hip);
    expect(widerHip.half.chest).toBe(base.half.chest);
  });

  it('a measured shoulder width is drawn at that width', () => {
    const rig = computeAvatarRig(input({ ...BASE, shoulderCm: 46 }));
    expect(rig.half.shoulder).toBeCloseTo((46 * RIG_PX_PER_CM) / 2, 1);
  });

  it('the inseam sets leg length; the sleeve sets arm length', () => {
    const shortLegs = computeAvatarRig(input({ ...BASE, inseamCm: 74 }));
    const longLegs = computeAvatarRig(input({ ...BASE, inseamCm: 86 }));
    expect(longLegs.floor - longLegs.y.crotch).toBeGreaterThan(
      shortLegs.floor - shortLegs.y.crotch,
    );
    expect(longLegs.floor - longLegs.y.crotch).toBeCloseTo(86 * RIG_PX_PER_CM, 1);

    const armLength = (rig: ReturnType<typeof computeAvatarRig>) =>
      Math.hypot(rig.arm.wrist[0] - rig.arm.shoulder[0], rig.arm.wrist[1] - rig.arm.shoulder[1]);
    const shortArms = computeAvatarRig(input({ ...BASE, sleeveLengthCm: 56 }));
    const longArms = computeAvatarRig(input({ ...BASE, sleeveLengthCm: 64 }));
    expect(armLength(longArms)).toBeGreaterThan(armLength(shortArms));
    expect(armLength(longArms)).toBeCloseTo(64 * RIG_PX_PER_CM, 0);
  });

  it('records which measurements drew the figure', () => {
    const rig = computeAvatarRig(input({ ...BASE, chestCm: 100 }));
    expect(rig.measured).toMatchObject({
      heightCm: true,
      chestCm: true,
      hipCm: false,
      inseamCm: false,
    });
  });

  it('weight only thickens limbs, and never moves a landmark', () => {
    const light = computeAvatarRig(input({ ...BASE, weightKg: 60 }));
    const heavy = computeAvatarRig(input({ ...BASE, weightKg: 110 }));
    expect(heavy.arm.half.upper).toBeGreaterThan(light.arm.half.upper);
    expect(heavy.y).toEqual(light.y);
    expect(heavy.half.waist).toBe(light.half.waist);
  });
});

describe('computeAvatarRig — nothing unmeasured is guessed, nothing invalid is drawn', () => {
  it('an empty profile draws a neutral figure', () => {
    const rig = computeAvatarRig(input({}));
    expect(rig.heightCm).toBeNull();
    expect(rig.drawnHeightCm).toBe(170);
    expect(Object.values(rig.measured).every((m) => !m)).toBe(true);
  });

  it('values outside the profile’s bounds, or not numbers, count as not entered', () => {
    const neutral = computeAvatarRig(input({}));
    const invalid = computeAvatarRig(
      input({
        heightCm: 9999,
        waistCm: Number.NaN,
        chestCm: -40,
        hipCm: Number.POSITIVE_INFINITY,
        inseamCm: 0,
      } as AvatarRenderInput['measurements']),
    );
    expect(invalid).toEqual(neutral);
  });

  it('keeps every point on the canvas, at the extremes of the profile’s bounds', () => {
    for (const heightCm of [50, 260]) {
      const rig = computeAvatarRig(
        input({ heightCm, weightKg: 350, waistCm: 250, chestCm: 250, hipCm: 250, shoulderCm: 80 }),
      );
      expect(rig.top).toBeGreaterThanOrEqual(0);
      expect(rig.cx - rig.half.hip).toBeGreaterThan(0);
      expect(rig.arm.hand.cx - rig.arm.hand.rx).toBeGreaterThan(-10);
    }
  });

  it('appearance never changes the body', () => {
    const plain = computeAvatarRig(input(BASE));
    const styled = computeAvatarRig({
      measurements: BASE,
      appearance: {
        ...NEUTRAL_APPEARANCE,
        skinTone: 'DARK',
        hairStyle: 'COVERED',
        wearsGlasses: true,
      },
      bodyShape: 'HIPS_WIDER',
    });
    expect(styled).toEqual(plain);
  });
});
