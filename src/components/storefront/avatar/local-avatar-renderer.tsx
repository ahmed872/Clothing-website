import { useId } from 'react';

import type { AvatarAppearance } from '@/lib/avatar/avatar-model';
import {
  composeLayers,
  type AvatarLayer,
  type AvatarPaint,
  type AvatarScene,
} from '@/components/storefront/avatar/avatar-layers';
import { AVATAR_VIEWBOX, computeAvatarRig } from '@/components/storefront/avatar/avatar-rig';

import type { AvatarRendererProps } from './avatar-types';
import { BODY_LAYERS } from './layers/body-layers';
import { HEAD_LAYERS } from './layers/head-layers';

/**
 * The avatar, drawn locally as layered SVG (clothing P03) — no network, no
 * model, no photo. Proportions come from the body rig
 * (`lib/avatar/avatar-rig.ts`), appearance from the customer's explicit
 * choices only, and the picture is a stack of layers
 * (`lib/avatar/avatar-layers.ts`): the base body and plain base outfit here,
 * with any garment layers the caller passes (`layers`) taking their slots.
 *
 * Deterministic — the same profile always draws the same markup — and
 * cheap: one pure computation and a few dozen paths, no canvas, no
 * animation loop. Shape changes ease in over the design system's standard
 * duration, and not at all under `prefers-reduced-motion`
 * (`.avatar-motion` in `globals.css`).
 *
 * Every colour is a design token (`--avatar-*`). The root's `data-*`
 * attributes say what was drawn, for tests and for the fitting room.
 */

export const BASE_AVATAR_LAYERS: readonly AvatarLayer[] = [...BODY_LAYERS, ...HEAD_LAYERS];

const slug = (value: string) => value.toLowerCase().replaceAll('_', '-');
const token = (group: string, value: string | null, fallback: string) =>
  `var(--avatar-${group}-${value ? slug(value) : fallback})`;

export function avatarPaint(appearance: AvatarAppearance): AvatarPaint {
  return {
    skin: token('skin', appearance.skinTone, 'unset'),
    hair: token('hair', appearance.hairColor, 'unset'),
    feature: 'var(--avatar-feature)',
    outline: 'var(--avatar-outline)',
    shade: 'var(--avatar-shade)',
    highlight: 'var(--avatar-highlight)',
    frame: token('frame', appearance.wearsGlasses ? appearance.glassesFrameColor : null, 'black'),
    lens: 'var(--avatar-lens)',
    covering: 'var(--avatar-covering)',
  };
}

const RULER_TICKS_CM = [50, 100, 150, 200];

export function LocalAvatarRenderer({
  input,
  title,
  description,
  heightLabel,
  direction,
  layers = [],
}: AvatarRendererProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const rig = computeAvatarRig(input);
  const a = input.appearance;
  const composed = composeLayers(BASE_AVATAR_LAYERS, layers);
  const scene: AvatarScene = { rig, appearance: a, paint: avatarPaint(a), direction, idPrefix: id };
  const { width, height, floorY } = AVATAR_VIEWBOX;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="avatar-motion h-auto w-full"
      data-renderer="local"
      data-layers={composed.map((layer) => layer.id).join(' ')}
      data-height-cm={rig.heightCm ?? ''}
      data-body-shape={input.bodyShape ?? 'unset'}
      data-skin-tone={a.skinTone ?? 'unset'}
      data-hair-style={a.hairStyle ?? 'unset'}
      data-hair-color={a.hairColor ?? 'unset'}
      data-facial-hair={a.facialHair ?? 'unset'}
      data-glasses={a.wearsGlasses ? (a.glassesStyle ?? 'ROUND') : 'none'}
      data-frame-color={a.wearsGlasses ? (a.glassesFrameColor ?? 'BLACK') : 'none'}
    >
      <title id={titleId}>{title}</title>
      <desc id={descId}>{description}</desc>

      {/* Height guide: a ruler every 50 cm, and a marker at the top of the head. */}
      <g stroke="var(--avatar-guide)" strokeWidth={1} fill="var(--avatar-guide-text)" fontSize={9}>
        <line x1={14} y1={floorY} x2={14} y2={floorY - 235 * rig.scale} />
        {RULER_TICKS_CM.map((cm) => {
          const y = floorY - cm * rig.scale;
          return (
            <g key={cm}>
              <line x1={10} y1={y} x2={18} y2={y} />
              <text x={22} y={y + 3} stroke="none">
                {cm}
              </text>
            </g>
          );
        })}
        {rig.heightCm !== null ? (
          <>
            <line
              x1={14}
              y1={rig.top}
              x2={rig.cx + rig.half.shoulder + 6}
              y2={rig.top}
              strokeDasharray="3 3"
            />
            <text
              x={width - 6}
              y={rig.top - 5}
              textAnchor={direction === 'rtl' ? 'start' : 'end'}
              stroke="none"
              fontSize={11}
              fontWeight={600}
              direction={direction}
              data-testid="avatar-height-label"
            >
              {heightLabel}
            </text>
          </>
        ) : null}
      </g>

      {composed.map((layer) => (
        <g key={layer.id} data-layer={layer.slot} data-layer-id={layer.id}>
          {layer.render(scene)}
        </g>
      ))}
    </svg>
  );
}
