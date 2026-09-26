import type { ReactNode } from 'react';

import type { AvatarAppearance } from '@/lib/avatar/avatar-model';
import type { AvatarRig } from './avatar-rig';

/**
 * The avatar as a stack of layers (clothing P03) — the architecture the
 * fitting room (P04) dresses.
 *
 *   Avatar
 *    ├── shadow        the floor
 *    ├── back          garment parts behind the body (a hood, a drape)
 *    ├── hairBack      hair that falls behind the shoulders
 *    ├── body          skin: legs, torso, arms, hands, neck, feet
 *    ├── bottom        trousers, a skirt, shorts
 *    ├── shoes
 *    ├── top           a T-shirt, a shirt — or a full-length dress, abaya
 *    │                 or thobe, which also replaces `bottom`
 *    ├── outerwear     a jacket, a cardigan
 *    ├── head          head and ears, over any collar
 *    ├── face          eyes, brows, nose, mouth
 *    ├── facialHair
 *    ├── hair          hair over the crown
 *    ├── covering      a head covering, over everything on the head
 *    ├── glasses
 *    └── accessories
 *
 * A layer draws itself from the scene (the rig, the chosen appearance and
 * the paint) and nothing else. The renderer composes a base set with any
 * extra layers it is handed: an extra layer takes its slot over from the
 * base layer there (a garment's top replaces the plain base top), and may
 * name further slots it covers (`replaces`). Nothing about a garment is
 * known to the body layers, and nothing about the body is guessed by a
 * garment — both read the same rig.
 */

export const AVATAR_LAYER_ORDER = [
  'shadow',
  'back',
  'hairBack',
  'body',
  'bottom',
  'shoes',
  'top',
  'outerwear',
  'head',
  'face',
  'facialHair',
  'hair',
  'covering',
  'glasses',
  'accessories',
] as const;
export type AvatarLayerSlot = (typeof AVATAR_LAYER_ORDER)[number];

/** Colours a layer paints with: CSS values, all design tokens. */
export interface AvatarPaint {
  skin: string;
  hair: string;
  feature: string;
  outline: string;
  shade: string;
  highlight: string;
  frame: string;
  lens: string;
  covering: string;
}

export interface AvatarScene {
  rig: AvatarRig;
  appearance: AvatarAppearance;
  paint: AvatarPaint;
  direction: 'rtl' | 'ltr';
  /** A prefix for any id a layer defines (a clip path, a gradient), unique
   * to this avatar on the page. */
  idPrefix: string;
}

export interface AvatarLayer {
  /** Stable, for React keys and for tests: `base:top`, `garment:top:…`. */
  id: string;
  slot: AvatarLayerSlot;
  /** Further slots this layer covers, so their base layers are not drawn
   * (a dress in `top` replaces the base `bottom`). */
  replaces?: readonly AvatarLayerSlot[];
  render: (scene: AvatarScene) => ReactNode;
}

const ORDER_INDEX = new Map<AvatarLayerSlot, number>(
  AVATAR_LAYER_ORDER.map((slot, i) => [slot, i]),
);

/**
 * The layers to draw, back to front: `base` with every slot an `extra`
 * layer takes (or replaces) removed, plus the extras, sorted by slot —
 * layers sharing a slot keep the order they were given in. Pure.
 */
export function composeLayers(
  base: readonly AvatarLayer[],
  extra: readonly AvatarLayer[] = [],
): AvatarLayer[] {
  const taken = new Set<AvatarLayerSlot>();
  for (const layer of extra) {
    taken.add(layer.slot);
    for (const slot of layer.replaces ?? []) taken.add(slot);
  }
  const kept = base.filter((layer) => !taken.has(layer.slot));
  return [...kept, ...extra]
    .map((layer, index) => ({ layer, index }))
    .sort(
      (a, b) =>
        ORDER_INDEX.get(a.layer.slot)! - ORDER_INDEX.get(b.layer.slot)! || a.index - b.index,
    )
    .map(({ layer }) => layer);
}
