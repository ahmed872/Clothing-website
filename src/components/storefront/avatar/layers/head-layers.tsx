import type { AvatarLayer, AvatarScene } from '@/components/storefront/avatar/avatar-layers';
import type { Point } from '@/components/storefront/avatar/avatar-rig';
import { smoothClosed } from '@/components/storefront/avatar/avatar-shapes';

/**
 * Head, face, hair, facial hair, head covering and glasses (clothing P03) —
 * each drawn only from what the customer chose. An unset hair style draws
 * no hair; an unset skin tone a neutral grey; nothing is filled in from
 * another field.
 */

type Head = AvatarScene['rig']['head'];

/** The head's outline: rounder at the crown, narrowing to the jaw. */
function headPath({ cx, cy, rx, ry }: Head): string {
  const points: Point[] = [
    [cx, cy - ry],
    [cx + rx * 0.82, cy - ry * 0.72],
    [cx + rx, cy - ry * 0.12],
    [cx + rx * 0.9, cy + ry * 0.42],
    [cx + rx * 0.52, cy + ry * 0.86],
    [cx, cy + ry],
    [cx - rx * 0.52, cy + ry * 0.86],
    [cx - rx * 0.9, cy + ry * 0.42],
    [cx - rx, cy - ry * 0.12],
    [cx - rx * 0.82, cy - ry * 0.72],
    [cx, cy - ry],
  ];
  return smoothClosed(points);
}

const headLayer: AvatarLayer = {
  id: 'base:head',
  slot: 'head',
  render: ({ rig, paint }) => {
    const h = rig.head;
    return (
      <g data-part="head">
        {[-1, 1].map((side) => (
          <ellipse
            key={side}
            cx={h.cx + side * h.rx * 0.98}
            cy={h.cy + h.ry * 0.05}
            rx={h.rx * 0.16}
            ry={h.ry * 0.2}
            fill={paint.skin}
            stroke={paint.outline}
          />
        ))}
        <path d={headPath(h)} fill={paint.skin} stroke={paint.outline} />
      </g>
    );
  },
};

const faceLayer: AvatarLayer = {
  id: 'base:face',
  slot: 'face',
  render: ({ rig, paint, appearance }) => {
    const { cx, cy, rx, ry } = rig.head;
    const eyeY = cy + ry * 0.04;
    const dx = rx * 0.4;
    const brow =
      appearance.hairColor && appearance.hairStyle !== 'COVERED' ? paint.hair : paint.feature;
    return (
      <g data-part="face">
        {[-1, 1].map((side) => (
          <g key={side}>
            <ellipse
              cx={cx + side * dx}
              cy={eyeY}
              rx={rx * 0.17}
              ry={ry * 0.07}
              fill="var(--avatar-eye-white)"
            />
            <circle cx={cx + side * dx} cy={eyeY} r={ry * 0.058} fill={paint.feature} />
            <path
              d={`M ${cx + side * (dx - rx * 0.2)} ${eyeY - ry * 0.13} Q ${cx + side * dx} ${eyeY - ry * 0.2} ${cx + side * (dx + rx * 0.2)} ${eyeY - ry * 0.12}`}
              stroke={brow}
              strokeWidth={Math.max(1, ry * 0.05)}
              strokeLinecap="round"
              fill="none"
            />
          </g>
        ))}
        <path
          d={`M ${cx - rx * 0.04} ${eyeY + ry * 0.08} Q ${cx - rx * 0.1} ${eyeY + ry * 0.3} ${cx + rx * 0.03} ${eyeY + ry * 0.32}`}
          stroke={paint.shade}
          strokeWidth={1.2}
          strokeLinecap="round"
          fill="none"
        />
        <path
          d={`M ${cx - rx * 0.24} ${cy + ry * 0.55} Q ${cx} ${cy + ry * 0.66} ${cx + rx * 0.24} ${cy + ry * 0.55}`}
          stroke="var(--avatar-mouth)"
          strokeWidth={Math.max(1.2, ry * 0.05)}
          strokeLinecap="round"
          fill="none"
        />
      </g>
    );
  },
};

const facialHairLayer: AvatarLayer = {
  id: 'base:facialHair',
  slot: 'facialHair',
  render: ({ rig, paint, appearance }) => {
    const { cx, cy, rx, ry } = rig.head;
    const style = appearance.facialHair;
    if (!style || style === 'NONE') return null;
    const mustache = `M ${cx - rx * 0.4} ${cy + ry * 0.5} Q ${cx - rx * 0.2} ${cy + ry * 0.36} ${cx} ${cy + ry * 0.44} Q ${cx + rx * 0.2} ${cy + ry * 0.36} ${cx + rx * 0.4} ${cy + ry * 0.5} Q ${cx} ${cy + ry * 0.47} ${cx - rx * 0.4} ${cy + ry * 0.5} Z`;
    if (style === 'MUSTACHE') {
      return <path data-part="facial-hair" d={mustache} fill={paint.hair} />;
    }
    const long = style === 'LONG_BEARD';
    const chin = cy + ry * (long ? 1.7 : 1.12);
    // Along the jaw from ear to ear, around the mouth.
    const beard = `M ${cx - rx * 0.98} ${cy} Q ${cx - rx * 0.96} ${cy + ry * 0.62} ${cx - rx * (long ? 0.5 : 0.56)} ${cy + ry * (long ? 1.2 : 0.92)} Q ${cx} ${chin + ry * 0.12} ${cx + rx * (long ? 0.5 : 0.56)} ${cy + ry * (long ? 1.2 : 0.92)} Q ${cx + rx * 0.96} ${cy + ry * 0.62} ${cx + rx * 0.98} ${cy} L ${cx + rx * 0.84} ${cy + ry * 0.12} Q ${cx + rx * 0.62} ${cy + ry * 0.62} ${cx + rx * 0.28} ${cy + ry * 0.66} Q ${cx} ${cy + ry * 0.76} ${cx - rx * 0.28} ${cy + ry * 0.66} Q ${cx - rx * 0.62} ${cy + ry * 0.62} ${cx - rx * 0.84} ${cy + ry * 0.12} Z`;
    return (
      <g data-part="facial-hair">
        <path d={beard} fill={paint.hair} opacity={0.95} />
        <path d={mustache} fill={paint.hair} />
      </g>
    );
  },
};

/** The crown: hair hugging the skull above the hairline. */
function crown(
  { cx, cy, rx, ry }: Head,
  lift = 1.12,
  part: 'side' | 'center' | 'none' = 'side',
): string {
  const hairline = cy - ry * 0.34;
  const partX = part === 'side' ? cx - rx * 0.3 : cx;
  return `M ${cx - rx * 1.04} ${cy - ry * 0.02} Q ${cx - rx * 1.12} ${cy - ry * lift} ${cx} ${cy - ry * lift} Q ${cx + rx * 1.12} ${cy - ry * lift} ${cx + rx * 1.04} ${cy - ry * 0.02} Q ${cx + rx * 0.92} ${hairline} ${partX} ${hairline - ry * 0.08} Q ${cx - rx * 0.92} ${hairline} ${cx - rx * 1.04} ${cy - ry * 0.02} Z`;
}

/** Hair falling behind the head and shoulders, to `bottom`, `width` head-radii
 * wide, optionally with a wavy edge. */
function backPanel({ cx, cy, rx, ry }: Head, bottom: number, width: number, wavy = false): string {
  const w = rx * width;
  const edge = wavy
    ? `Q ${cx + w * 0.66} ${bottom + 7} ${cx + w * 0.33} ${bottom} Q ${cx} ${bottom + 7} ${cx - w * 0.33} ${bottom} Q ${cx - w * 0.66} ${bottom + 7} ${cx - w} ${bottom}`
    : `Q ${cx} ${bottom + 6} ${cx - w} ${bottom}`;
  return `M ${cx - w} ${cy - ry * 0.3} Q ${cx - w * 1.02} ${cy - ry * 1.25} ${cx} ${cy - ry * 1.18} Q ${cx + w * 1.02} ${cy - ry * 1.25} ${cx + w} ${cy - ry * 0.3} L ${cx + w} ${bottom} ${edge} Z`;
}

const hairBackLayer: AvatarLayer = {
  id: 'base:hairBack',
  slot: 'hairBack',
  render: ({ rig, paint, appearance }) => {
    const h = rig.head;
    const d = (() => {
      switch (appearance.hairStyle) {
        case 'LONG':
          return backPanel(h, rig.y.chest + 4, 1.22);
        case 'STRAIGHT':
          return backPanel(h, rig.y.armpit, 1.14);
        case 'WAVY':
          return backPanel(h, rig.y.shoulder + 14, 1.26, true);
        case 'MEDIUM':
          return backPanel(h, h.chinY + 2, 1.14);
        default:
          return null;
      }
    })();
    return d ? <path data-part="hair-back" d={d} fill={paint.hair} stroke={paint.outline} /> : null;
  },
};

const hairLayer: AvatarLayer = {
  id: 'base:hair',
  slot: 'hair',
  render: ({ rig, paint, appearance }) => {
    const h = rig.head;
    const { cx, cy, rx, ry } = h;
    switch (appearance.hairStyle) {
      case null:
      case 'COVERED':
        return null;
      case 'BUZZ':
        return (
          <path data-part="hair" d={crown(h, 1.06, 'none')} fill={paint.hair} opacity={0.55} />
        );
      case 'CURLY': {
        const curls = Array.from({ length: 11 }, (_, i) => {
          const angle = Math.PI * (1.02 + (i / 10) * 0.96);
          return [
            cx + Math.cos(angle) * rx * 1.02,
            cy - ry * 0.05 + Math.sin(angle) * ry * 1.02,
          ] as const;
        });
        return (
          <g data-part="hair">
            <path d={crown(h, 1.16, 'none')} fill={paint.hair} />
            {curls.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={rx * 0.3} fill={paint.hair} stroke={paint.outline} />
            ))}
          </g>
        );
      }
      case 'STRAIGHT':
      case 'LONG': {
        // Locks framing the face and falling in front of the shoulders —
        // long hair seen from the front is mostly this, not the back.
        const bottom = appearance.hairStyle === 'LONG' ? rig.y.chest + 6 : rig.y.armpit;
        return (
          <g data-part="hair">
            <path d={crown(h, 1.14, 'center')} fill={paint.hair} stroke={paint.outline} />
            {[-1, 1].map((side) => (
              <path
                key={side}
                d={`M ${cx + side * rx * 1.06} ${cy - ry * 0.2} Q ${cx + side * rx * 1.2} ${cy + ry * 0.7} ${cx + side * rx * 1.28} ${h.chinY + ry * 0.35} Q ${cx + side * rx * 1.4} ${rig.y.shoulder + 4} ${cx + side * rx * 1.3} ${bottom} Q ${cx + side * rx * 1.02} ${bottom + 4} ${cx + side * rx * 0.88} ${bottom - 6} Q ${cx + side * rx * 0.98} ${rig.y.shoulder} ${cx + side * rx * 0.86} ${cy + ry * 0.2} Z`}
                fill={paint.hair}
                stroke={paint.outline}
              />
            ))}
          </g>
        );
      }
      case 'WAVY':
      case 'MEDIUM': {
        // Medium stops at the jaw; wavy falls, rippling, to the shoulders.
        const wavy = appearance.hairStyle === 'WAVY';
        const bottom = wavy ? rig.y.shoulder + 8 : h.chinY;
        return (
          <g data-part="hair">
            <path d={crown(h, 1.16, 'side')} fill={paint.hair} stroke={paint.outline} />
            {[-1, 1].map((side) => (
              <path
                key={side}
                d={`M ${cx + side * rx * 1.05} ${cy - ry * 0.15} Q ${cx + side * rx * 1.24} ${cy + ry * 0.4} ${cx + side * rx * (wavy ? 1.1 : 1.14)} ${cy + ry * 0.75} ${wavy ? `Q ${cx + side * rx * 1.36} ${h.chinY + ry * 0.2} ${cx + side * rx * 1.2} ${bottom}` : `L ${cx + side * rx * 1.08} ${bottom}`} Q ${cx + side * rx * 1.0} ${bottom + 3} ${cx + side * rx * 0.9} ${bottom - 4} L ${cx + side * rx * 0.88} ${cy + ry * 0.05} Z`}
                fill={paint.hair}
                stroke={paint.outline}
              />
            ))}
          </g>
        );
      }
      case 'SHORT':
      default:
        return (
          <path
            data-part="hair"
            d={crown(h, 1.12, 'side')}
            fill={paint.hair}
            stroke={paint.outline}
          />
        );
    }
  },
};

const coveringLayer: AvatarLayer = {
  id: 'base:covering',
  slot: 'covering',
  render: ({ rig, paint, appearance }) => {
    if (appearance.hairStyle !== 'COVERED') return null;
    const { cx, cy, rx, ry, chinY } = rig.head;
    const s = rig.half.shoulder;
    // Around the head, under the chin and over the shoulders to the chest;
    // the face left open (even-odd).
    const outer = `M ${cx} ${cy - ry * 1.3} Q ${cx + rx * 1.55} ${cy - ry * 1.22} ${cx + rx * 1.36} ${cy + ry * 0.55} Q ${cx + s * 0.75} ${rig.y.shoulder + 2} ${cx + s * 0.92} ${rig.y.chest - 2} Q ${cx} ${rig.y.chest + 10} ${cx - s * 0.92} ${rig.y.chest - 2} Q ${cx - s * 0.75} ${rig.y.shoulder + 2} ${cx - rx * 1.36} ${cy + ry * 0.55} Q ${cx - rx * 1.55} ${cy - ry * 1.22} ${cx} ${cy - ry * 1.3} Z`;
    const face = `M ${cx} ${cy - ry * 0.74} C ${cx + rx * 1.08} ${cy - ry * 0.74} ${cx + rx * 0.96} ${chinY - ry * 0.1} ${cx} ${chinY + ry * 0.04} C ${cx - rx * 0.96} ${chinY - ry * 0.1} ${cx - rx * 1.08} ${cy - ry * 0.74} ${cx} ${cy - ry * 0.74} Z`;
    return (
      <g data-part="covering">
        <path
          d={`${outer} ${face}`}
          fillRule="evenodd"
          fill={paint.covering}
          stroke={paint.outline}
        />
        {/* A soft fold under the chin. */}
        <path
          d={`M ${cx - rx * 0.7} ${chinY + ry * 0.2} Q ${cx} ${chinY + ry * 0.5} ${cx + rx * 0.7} ${chinY + ry * 0.2}`}
          stroke={paint.shade}
          strokeWidth={1.4}
          fill="none"
        />
      </g>
    );
  },
};

const glassesLayer: AvatarLayer = {
  id: 'base:glasses',
  slot: 'glasses',
  render: ({ rig, paint, appearance }) => {
    if (!appearance.wearsGlasses) return null;
    const { cx, cy, rx, ry } = rig.head;
    const eyeY = cy + ry * 0.04;
    const dx = rx * 0.4;
    const w = rx * 0.28;
    const h = ry * 0.14;
    const lens = (ex: number) => {
      switch (appearance.glassesStyle) {
        case 'RECTANGULAR':
          return <rect x={ex - w} y={eyeY - h} width={w * 2} height={h * 2} rx={1.5} />;
        case 'AVIATOR':
          return (
            <path
              d={`M ${ex - w} ${eyeY - h} L ${ex + w} ${eyeY - h} Q ${ex + w * 1.08} ${eyeY + h * 1.7} ${ex} ${eyeY + h * 1.5} Q ${ex - w * 1.08} ${eyeY + h * 1.5} ${ex - w} ${eyeY - h} Z`}
            />
          );
        case 'CAT_EYE':
          return (
            <path
              d={`M ${ex - w * 1.12} ${eyeY - h * 1.4} Q ${ex} ${eyeY - h} ${ex + w * 1.12} ${eyeY - h * 1.4} Q ${ex + w} ${eyeY + h * 1.25} ${ex} ${eyeY + h * 1.05} Q ${ex - w} ${eyeY + h * 1.25} ${ex - w * 1.12} ${eyeY - h * 1.4} Z`}
            />
          );
        default:
          return <circle cx={ex} cy={eyeY} r={w * 0.98} />;
      }
    };
    return (
      <g
        data-part="glasses"
        stroke={paint.frame}
        strokeWidth={Math.max(1.2, rx * 0.075)}
        fill={paint.lens}
      >
        {lens(cx - dx)}
        {lens(cx + dx)}
        <path
          d={`M ${cx - dx + w * 0.92} ${eyeY - 0.5} Q ${cx} ${eyeY - h * 0.9} ${cx + dx - w * 0.92} ${eyeY - 0.5}`}
          fill="none"
        />
        <path d={`M ${cx - dx - w} ${eyeY} L ${cx - rx * 0.98} ${eyeY - 1}`} fill="none" />
        <path d={`M ${cx + dx + w} ${eyeY} L ${cx + rx * 0.98} ${eyeY - 1}`} fill="none" />
      </g>
    );
  },
};

export const HEAD_LAYERS: readonly AvatarLayer[] = [
  hairBackLayer,
  headLayer,
  faceLayer,
  facialHairLayer,
  hairLayer,
  coveringLayer,
  glassesLayer,
];
