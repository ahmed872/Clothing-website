import { describe, expect, it } from 'vitest';

import {
  AVATAR_LAYER_ORDER,
  composeLayers,
  type AvatarLayer,
  type AvatarLayerSlot,
} from './avatar-layers';
import { NEUTRAL_APPEARANCE } from '@/lib/avatar/avatar-model';
import { computeAvatarRig } from './avatar-rig';
import { limbOutline, smoothClosed, torsoBand, torsoEdge, torsoXAt } from './avatar-shapes';

const layer = (id: string, slot: AvatarLayerSlot, replaces?: AvatarLayerSlot[]): AvatarLayer => ({
  id,
  slot,
  replaces,
  render: () => null,
});

const BASE = [
  layer('base:shadow', 'shadow'),
  layer('base:body', 'body'),
  layer('base:bottom', 'bottom'),
  layer('base:shoes', 'shoes'),
  layer('base:top', 'top'),
  layer('base:head', 'head'),
  layer('base:hair', 'hair'),
];

describe('composeLayers — the stack a garment dresses', () => {
  it('draws back to front in the documented slot order', () => {
    const ids = composeLayers([...BASE].reverse()).map((l) => l.id);
    expect(ids).toEqual([
      'base:shadow',
      'base:body',
      'base:bottom',
      'base:shoes',
      'base:top',
      'base:head',
      'base:hair',
    ]);
  });

  it('a garment takes its slot over from the base layer there', () => {
    const ids = composeLayers(BASE, [layer('garment:top', 'top')]).map((l) => l.id);
    expect(ids).toContain('garment:top');
    expect(ids).not.toContain('base:top');
    expect(ids).toContain('base:bottom');
  });

  it('a full-length garment replaces the bottom too', () => {
    const ids = composeLayers(BASE, [layer('garment:thobe', 'top', ['bottom'])]).map((l) => l.id);
    expect(ids).not.toContain('base:top');
    expect(ids).not.toContain('base:bottom');
    expect(ids.indexOf('garment:thobe')).toBeLessThan(ids.indexOf('base:head'));
  });

  it('extra layers in the same slot keep the order they were given', () => {
    const ids = composeLayers([], [layer('b', 'accessories'), layer('a', 'accessories')]).map(
      (l) => l.id,
    );
    expect(ids).toEqual(['b', 'a']);
  });

  it('every slot is in the order exactly once', () => {
    expect(new Set(AVATAR_LAYER_ORDER).size).toBe(AVATAR_LAYER_ORDER.length);
  });
});

describe('avatar shapes — stable paths from the rig', () => {
  const rig = computeAvatarRig({
    measurements: { heightCm: 177, weightKg: 78, waistCm: 84, chestCm: 100, hipCm: 98 },
    appearance: NEUTRAL_APPEARANCE,
  });

  it('the torso edge passes through the measured widths', () => {
    const edge = torsoEdge(rig);
    expect(torsoXAt(edge, rig.y.waist)).toBeCloseTo(rig.cx - rig.half.waist, 5);
    expect(torsoXAt(edge, rig.y.chest)).toBeCloseTo(rig.cx - rig.half.chest, 5);
    expect(torsoXAt(torsoEdge(rig, 4), rig.y.waist)).toBeCloseTo(rig.cx - rig.half.waist - 4, 5);
  });

  it('builds closed, deterministic paths with one-decimal numbers', () => {
    const d = torsoBand(rig, { to: rig.y.crotch });
    expect(d.startsWith('M ')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).toBe(torsoBand(rig, { to: rig.y.crotch }));
    expect(d).not.toMatch(/\d\.\d{2,}/);
    expect(d).not.toMatch(/NaN|Infinity/);
  });

  it('limb and closed outlines are well formed', () => {
    const limb = limbOutline(
      [
        [10, 10],
        [12, 40],
        [14, 70],
      ],
      [6, 5, 3],
    );
    expect(limb).toMatch(/^M [\d.-]+ [\d.-]+ C .* Q .* C .* Q .* Z$/);
    const shape = smoothClosed([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(shape).toMatch(/^M 0 0 C .* Z$/);
  });
});
