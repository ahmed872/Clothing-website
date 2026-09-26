import type { AvatarLayer, AvatarScene } from '@/components/storefront/avatar/avatar-layers';
import { mirrorPoint, type AvatarRig, type Point } from '@/components/storefront/avatar/avatar-rig';
import { limbOutline, torsoBand } from '@/components/storefront/avatar/avatar-shapes';

/**
 * The body and the plain base outfit it wears until a garment is put on
 * (clothing P03). Skin is one colour with a soft shade on the far side of
 * each limb — light from the viewer's upper left — enough to read as a
 * figure, not a photograph.
 */

function lerp(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** The left leg's joints and half-widths, hip to ankle. */
export function legChain(rig: AvatarRig): { joints: Point[]; widths: number[] } {
  const { hip, knee, ankle, half } = rig.leg;
  const calf = lerp(knee, ankle, 0.28);
  const midThigh = lerp(hip, knee, 0.5);
  return {
    joints: [hip, midThigh, knee, calf, ankle],
    widths: [half.thigh, half.thigh * 0.86, half.knee, half.calf, half.ankle],
  };
}

/** The left arm's joints and half-widths, shoulder to wrist. */
export function armChain(rig: AvatarRig): { joints: Point[]; widths: number[] } {
  const { shoulder, elbow, wrist, half } = rig.arm;
  const forearm = lerp(elbow, wrist, 0.35);
  return {
    joints: [shoulder, elbow, forearm, wrist],
    widths: [half.upper, half.elbow, half.elbow * 0.95, half.wrist],
  };
}

export function mirrorChain(rig: AvatarRig, chain: { joints: Point[]; widths: number[] }) {
  return { joints: chain.joints.map((p) => mirrorPoint(rig, p)), widths: chain.widths };
}

function Limb({
  chain,
  fill,
  outline,
  shade,
}: {
  chain: { joints: Point[]; widths: number[] };
  fill: string;
  outline: string;
  shade?: string;
}) {
  const d = limbOutline(chain.joints, chain.widths);
  return (
    <>
      <path d={d} fill={fill} stroke={outline} strokeWidth={1} />
      {shade ? <path d={d} fill={shade} /> : null}
    </>
  );
}

const shadowLayer: AvatarLayer = {
  id: 'base:shadow',
  slot: 'shadow',
  render: ({ rig }) => (
    <ellipse
      cx={rig.cx}
      cy={rig.floor + 2}
      rx={rig.half.hip + 22}
      ry={5}
      fill="var(--avatar-shadow)"
    />
  ),
};

const bodyLayer: AvatarLayer = {
  id: 'base:body',
  slot: 'body',
  render: ({ rig, paint }) => {
    const leg = legChain(rig);
    const arm = armChain(rig);
    const { hand } = rig.arm;
    const { foot } = rig.leg;
    const neck = rig.neck;
    return (
      <g data-part="body">
        {/* Legs first, so the torso's hip line sits over their tops. */}
        <Limb chain={leg} fill={paint.skin} outline={paint.outline} />
        <Limb
          chain={mirrorChain(rig, leg)}
          fill={paint.skin}
          outline={paint.outline}
          shade={paint.shade}
        />
        {[foot.cx, 2 * rig.cx - foot.cx].map((x) => (
          <ellipse
            key={x}
            cx={x}
            cy={foot.cy}
            rx={foot.rx}
            ry={foot.ry}
            fill={paint.skin}
            stroke={paint.outline}
          />
        ))}
        {/* Arms before the torso, so the torso's edge covers the shoulder
            joint and the arm reads as growing out of it. */}
        <Limb chain={arm} fill={paint.skin} outline={paint.outline} />
        <Limb
          chain={mirrorChain(rig, arm)}
          fill={paint.skin}
          outline={paint.outline}
          shade={paint.shade}
        />
        <path
          d={torsoBand(rig, { to: rig.y.crotch, hemCurve: 3 })}
          fill={paint.skin}
          stroke={paint.outline}
        />
        {/* Neck: a tapered column from under the chin to the collarbones. */}
        <path
          d={`M ${rig.cx - neck.half * 0.9} ${neck.top} L ${rig.cx - neck.half} ${neck.base + 2} Q ${rig.cx} ${neck.base + 5} ${rig.cx + neck.half} ${neck.base + 2} L ${rig.cx + neck.half * 0.9} ${neck.top} Z`}
          fill={paint.skin}
        />
        <ellipse cx={rig.cx} cy={neck.top + 2} rx={neck.half * 0.95} ry={3} fill={paint.shade} />
        {[hand.cx, 2 * rig.cx - hand.cx].map((x) => (
          <ellipse
            key={x}
            cx={x}
            cy={hand.cy}
            rx={hand.rx}
            ry={hand.ry}
            fill={paint.skin}
            stroke={paint.outline}
          />
        ))}
      </g>
    );
  },
};

/** Where the base top ends and the base shorts begin — reused by the
 * garment layers for the same landmarks. */
export function baseHemY(rig: AvatarRig): number {
  return rig.y.waist + (rig.y.hip - rig.y.waist) * 0.62;
}

const baseTopLayer: AvatarLayer = {
  id: 'base:top',
  slot: 'top',
  render: ({ rig, paint }) => {
    const arm = armChain(rig);
    const sleeve = {
      joints: [arm.joints[0]!, lerp(arm.joints[0]!, arm.joints[1]!, 0.42)],
      widths: [arm.widths[0]! + 1.5, arm.widths[0]! + 1.2],
    };
    const neckline = rig.neck.base + 4;
    return (
      <g data-part="base-top">
        <Limb chain={sleeve} fill="var(--avatar-garment-top)" outline={paint.outline} />
        <Limb
          chain={mirrorChain(rig, sleeve)}
          fill="var(--avatar-garment-top)"
          outline={paint.outline}
          shade={paint.shade}
        />
        <path
          d={torsoBand(rig, { to: baseHemY(rig), ease: 1.5, hemCurve: 2 })}
          fill="var(--avatar-garment-top)"
          stroke={paint.outline}
        />
        {/* A soft scoop neckline, showing the skin beneath. */}
        <path
          d={`M ${rig.cx - rig.neck.half - 3} ${rig.neck.base - 1} Q ${rig.cx} ${neckline + 5} ${rig.cx + rig.neck.half + 3} ${rig.neck.base - 1} Z`}
          fill={paint.skin}
        />
      </g>
    );
  },
};

const baseBottomLayer: AvatarLayer = {
  id: 'base:bottom',
  slot: 'bottom',
  render: ({ rig, paint }) => {
    const leg = legChain(rig);
    const shortLeg = {
      joints: [leg.joints[0]!, lerp(leg.joints[0]!, leg.joints[2]!, 0.42)],
      widths: [leg.widths[0]! + 1.5, leg.widths[1]! + 1.5],
    };
    return (
      <g data-part="base-bottom">
        <Limb chain={shortLeg} fill="var(--avatar-garment-bottom)" outline={paint.outline} />
        <Limb
          chain={mirrorChain(rig, shortLeg)}
          fill="var(--avatar-garment-bottom)"
          outline={paint.outline}
        />
        <path
          d={torsoBand(rig, {
            from: rig.y.waist + 2,
            to: rig.y.crotch + 2,
            ease: 1.5,
            hemCurve: 2,
          })}
          fill="var(--avatar-garment-bottom)"
          stroke={paint.outline}
        />
      </g>
    );
  },
};

const baseShoesLayer: AvatarLayer = {
  id: 'base:shoes',
  slot: 'shoes',
  render: ({ rig, paint }) => {
    const { foot } = rig.leg;
    return (
      <g data-part="base-shoes">
        {[foot.cx, 2 * rig.cx - foot.cx].map((x) => (
          <path
            key={x}
            d={`M ${x - foot.rx} ${foot.cy + foot.ry} Q ${x - foot.rx * 1.05} ${foot.cy - foot.ry * 1.3} ${x} ${foot.cy - foot.ry * 1.4} Q ${x + foot.rx * 1.05} ${foot.cy - foot.ry * 1.3} ${x + foot.rx} ${foot.cy + foot.ry} Z`}
            fill="var(--avatar-garment-shoe)"
            stroke={paint.outline}
          />
        ))}
      </g>
    );
  },
};

export const BODY_LAYERS: readonly AvatarLayer[] = [
  shadowLayer,
  bodyLayer,
  baseBottomLayer,
  baseShoesLayer,
  baseTopLayer,
];

export type { AvatarScene };
