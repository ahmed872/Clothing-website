import { describe, expect, it } from 'vitest';

import { NEUTRAL_APPEARANCE } from './avatar-model';
import { AVATAR_CANVAS, PX_PER_CM, computeAvatarGeometry } from './local-avatar-geometry';

const base = { heightCm: 170, weightKg: 70, waistCm: 80 };
const geometry = (measurements: Record<string, number | null>) =>
  computeAvatarGeometry({ measurements, appearance: NEUTRAL_APPEARANCE });

describe('computeAvatarGeometry', () => {
  it('draws taller people taller, on one shared scale, standing on the same floor', () => {
    const short = geometry({ ...base, heightCm: 155 });
    const tall = geometry({ ...base, heightCm: 190 });
    expect(tall.figureHeight - short.figureHeight).toBeCloseTo(35 * PX_PER_CM);
    expect(short.y.floor).toBe(tall.y.floor);
    expect(tall.topY).toBeLessThan(short.topY);
  });

  it('keeps an extreme height on the canvas, while reporting the real value', () => {
    const g = geometry({ ...base, heightCm: 255 });
    expect(g.heightCm).toBe(255);
    expect(g.topY).toBeGreaterThanOrEqual(0);
  });

  it('widens exactly the part that was measured wider', () => {
    const narrow = geometry({ ...base, hipCm: 90 });
    const wide = geometry({ ...base, hipCm: 120 });
    expect(wide.half.hip).toBeGreaterThan(narrow.half.hip);
    expect(wide.half.waist).toBe(narrow.half.waist);
    expect(wide.half.chest).toBe(narrow.half.chest);
  });

  it('uses a measured shoulder width directly', () => {
    expect(geometry({ ...base, shoulderCm: 46 }).half.shoulder).toBeCloseTo((46 * PX_PER_CM) / 2);
  });

  it('sets leg length from a measured inseam', () => {
    const shortLegs = geometry({ ...base, inseamCm: 70 });
    const longLegs = geometry({ ...base, inseamCm: 84 });
    expect(longLegs.y.crotch).toBeLessThan(shortLegs.y.crotch);
  });

  it('falls back to a neutral figure with nothing measured', () => {
    const g = geometry({});
    expect(g.heightCm).toBeNull();
    expect(g.figureHeight).toBeCloseTo(170 * PX_PER_CM);
    expect(g.half.chest).toBe(g.half.hip);
  });

  it('never draws past the canvas edge', () => {
    const g = geometry({ ...base, waistCm: 250, chestCm: 250, hipCm: 250, shoulderCm: 80 });
    expect(AVATAR_CANVAS.centerX + g.half.shoulder).toBeLessThanOrEqual(AVATAR_CANVAS.width);
    expect(AVATAR_CANVAS.centerX - g.half.hip).toBeGreaterThanOrEqual(0);
  });
});
