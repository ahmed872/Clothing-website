import { MEASUREMENT_BOUNDS, type MeasurementKey } from '@/modules/body-profile/options';

import type { AvatarRenderInput } from '@/lib/avatar/avatar-model';

/**
 * The avatar's skeleton and silhouette, computed from the body profile
 * (clothing P03) — pure numbers, no drawing, so every renderer and every
 * garment layer reads the same body, and tests can check it directly.
 *
 * Front view, in SVG units, on one fixed scale for everyone (1.6 units per
 * centimetre), so 160 cm and 190 cm are different sizes, not the same
 * figure relabelled. Measured values decide what they measure:
 *
 *   height        → overall scale, and every landmark below
 *   shoulder      → shoulder width (across the back, point to point)
 *   chest/waist/hip → the torso's width at each (circumference → front
 *                   width as C/π × 1.18: a torso is an ellipse about 1.4×
 *                   wider than deep)
 *   inseam        → leg length (crotch height)
 *   sleeve length → arm length (shoulder point to wrist)
 *   neck          → neck width
 *   weight        → limb thickness only, gently (a drawing cue; weight
 *                   plays no part in sizing)
 *
 * Anything not measured takes a standard proportion — of height for
 * lengths, of the waist (which every profile has) for widths — never a
 * guess from gender or appearance. A value outside the profile's own
 * realistic bounds is treated as not entered, so a malformed input can
 * never draw a malformed body. Deterministic: same input, same rig.
 */

export const AVATAR_VIEWBOX = { width: 240, height: 420, floorY: 404, centerX: 120 } as const;
export const RIG_PX_PER_CM = 1.6;

/** Heights beyond this range are drawn at its edge (the label still shows
 * the real value). */
const DRAWABLE_HEIGHT_CM = { min: 90, max: 235 } as const;
const NEUTRAL_HEIGHT_CM = 170;
const NEUTRAL_WAIST_CM = 80;
const TORSO_ELLIPSE_FACTOR = 1.18;

/** Landmark heights as a share of stature, from the floor — standard
 * figure-drawing and anthropometric proportions, used for everything the
 * profile does not measure. */
export const LANDMARKS = {
  chin: 0.87,
  neckBase: 0.838,
  shoulder: 0.818,
  armpit: 0.765,
  chest: 0.725,
  waist: 0.615,
  hip: 0.525,
  crotch: 0.47,
  knee: 0.285,
  ankle: 0.04,
} as const;

/** Lengths and widths as a share of stature, for what is not measured. */
export const PROPORTIONS = {
  /** Shoulder point to wrist. */
  arm: 0.34,
  /** Of the arm, shoulder to elbow. */
  upperArmShare: 0.55,
  hand: 0.105,
  /** Allowed range for a measured inseam, so legs stay legs. */
  inseamMin: 0.4,
  inseamMax: 0.52,
  armMin: 0.28,
  armMax: 0.4,
  /** Limb half-widths per unit of stature, before build. */
  upperArmWidth: 0.0265,
  thighWidth: 0.052,
  /** Head width to head height. */
  headAspect: 0.68,
  footHeight: 0.035,
} as const;

export type Point = readonly [number, number];

export interface AvatarRig {
  /** The height the profile states (unclamped), or null if none. */
  heightCm: number | null;
  /** The stature actually drawn, in cm. */
  drawnHeightCm: number;
  scale: number;
  cx: number;
  top: number;
  floor: number;
  head: { cx: number; cy: number; rx: number; ry: number; chinY: number };
  neck: { top: number; base: number; half: number };
  y: {
    shoulder: number;
    armpit: number;
    chest: number;
    waist: number;
    hip: number;
    crotch: number;
    knee: number;
    ankle: number;
  };
  half: { shoulder: number; armpit: number; chest: number; waist: number; hip: number };
  /** The left arm (the figure's right); the other is its mirror. */
  arm: {
    shoulder: Point;
    elbow: Point;
    wrist: Point;
    half: { upper: number; elbow: number; wrist: number };
    hand: { cx: number; cy: number; rx: number; ry: number };
  };
  /** The left leg; the other is its mirror. */
  leg: {
    hip: Point;
    knee: Point;
    ankle: Point;
    half: { thigh: number; knee: number; calf: number; ankle: number };
    foot: { cx: number; cy: number; rx: number; ry: number };
  };
  /** Which measurements drew this figure — the rest took proportions. */
  measured: Readonly<Record<MeasurementKey, boolean>>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A measurement the renderer can trust: a finite number within the
 * profile's own bounds, or null. */
function valid(input: AvatarRenderInput, key: MeasurementKey): number | null {
  const value = input.measurements[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const { min, max } = MEASUREMENT_BOUNDS[key];
  return value >= min && value <= max ? value : null;
}

function girthHalf(circumferenceCm: number, scale: number): number {
  return ((circumferenceCm / Math.PI) * TORSO_ELLIPSE_FACTOR * scale) / 2;
}

export function computeAvatarRig(input: AvatarRenderInput): AvatarRig {
  const m = {
    heightCm: valid(input, 'heightCm'),
    weightKg: valid(input, 'weightKg'),
    waistCm: valid(input, 'waistCm'),
    chestCm: valid(input, 'chestCm'),
    hipCm: valid(input, 'hipCm'),
    shoulderCm: valid(input, 'shoulderCm'),
    inseamCm: valid(input, 'inseamCm'),
    sleeveLengthCm: valid(input, 'sleeveLengthCm'),
    neckCm: valid(input, 'neckCm'),
  };
  const scale = RIG_PX_PER_CM;
  const H = clamp(m.heightCm ?? NEUTRAL_HEIGHT_CM, DRAWABLE_HEIGHT_CM.min, DRAWABLE_HEIGHT_CM.max);
  const Hpx = H * scale;
  const cx = AVATAR_VIEWBOX.centerX;
  const floor = AVATAR_VIEWBOX.floorY;
  const top = floor - Hpx;
  const at = (share: number) => floor - Hpx * share;

  // Widths.
  const maxHalf = AVATAR_VIEWBOX.width / 2 - 32;
  const waistCm = m.waistCm ?? NEUTRAL_WAIST_CM;
  const waist = clamp(girthHalf(waistCm, scale), 10, maxHalf);
  const chest = clamp(girthHalf(m.chestCm ?? waistCm * 1.12, scale), 10, maxHalf);
  const hip = clamp(girthHalf(m.hipCm ?? waistCm * 1.12, scale), 10, maxHalf);
  const shoulder = clamp(
    m.shoulderCm !== null ? (m.shoulderCm * scale) / 2 : chest * 1.08,
    12,
    maxHalf + 6,
  );
  const armpit = Math.max(chest * 0.97, Math.min(shoulder - 4, chest * 1.02));

  // Build: limb thickness follows BMI gently, within limits.
  const bmi = m.heightCm && m.weightKg ? m.weightKg / (m.heightCm / 100) ** 2 : 22;
  const build = clamp(bmi / 22, 0.8, 1.6);

  // Head and neck.
  const chinY = at(LANDMARKS.chin);
  const headHeight = chinY - top;
  const head = {
    cx,
    cy: top + headHeight * 0.52,
    rx: (headHeight * PROPORTIONS.headAspect) / 2,
    ry: headHeight / 2,
    chinY,
  };
  const neckBase = at(LANDMARKS.neckBase);
  const neckHalf =
    m.neckCm !== null
      ? clamp((m.neckCm / Math.PI) * scale * 0.5, 5, head.rx * 0.75)
      : head.rx * 0.42;

  const y = {
    shoulder: at(LANDMARKS.shoulder),
    armpit: at(LANDMARKS.armpit),
    chest: at(LANDMARKS.chest),
    waist: at(LANDMARKS.waist),
    hip: at(LANDMARKS.hip),
    crotch:
      m.inseamCm !== null
        ? floor -
          clamp(m.inseamCm * scale, Hpx * PROPORTIONS.inseamMin, Hpx * PROPORTIONS.inseamMax)
        : at(LANDMARKS.crotch),
    knee: at(LANDMARKS.knee),
    ankle: at(LANDMARKS.ankle),
  };
  // A long measured inseam must not push the crotch above the hip line.
  y.crotch = Math.max(y.crotch, y.hip + 4);
  y.knee = y.crotch + (floor - y.crotch) * 0.5 - Hpx * 0.01;

  // Arms, hanging just clear of the body.
  const upperHalf = Hpx * PROPORTIONS.upperArmWidth * Math.sqrt(build);
  const armHalf = { upper: upperHalf, elbow: upperHalf * 0.78, wrist: upperHalf * 0.55 };
  const armLength =
    m.sleeveLengthCm !== null
      ? clamp(m.sleeveLengthCm * scale, Hpx * PROPORTIONS.armMin, Hpx * PROPORTIONS.armMax)
      : Hpx * PROPORTIONS.arm;
  const shoulderJoint: Point = [cx - shoulder + upperHalf * 0.7, y.shoulder + upperHalf * 0.9];
  const clearX = cx - Math.max(hip, waist, chest * 0.96) - armHalf.wrist - 5;
  const dx = clamp(clearX - shoulderJoint[0], -armLength * 0.45, armLength * 0.1);
  const dy = Math.sqrt(armLength ** 2 - dx ** 2);
  const wrist: Point = [shoulderJoint[0] + dx, shoulderJoint[1] + dy];
  const elbow: Point = [
    shoulderJoint[0] + dx * PROPORTIONS.upperArmShare - 1.5,
    shoulderJoint[1] + dy * PROPORTIONS.upperArmShare,
  ];
  const handLength = Hpx * PROPORTIONS.hand;
  const hand = {
    cx: wrist[0] - 0.5,
    cy: wrist[1] + handLength * 0.45,
    rx: armHalf.wrist * 1.35,
    ry: handLength * 0.48,
  };

  // Legs.
  const thighHalf = Math.min(
    hip * 0.5,
    Hpx * PROPORTIONS.thighWidth * Math.sqrt(build) * 0.5 + hip * 0.12,
  );
  const legHalf = {
    thigh: thighHalf,
    knee: thighHalf * 0.6,
    calf: thighHalf * 0.66,
    ankle: thighHalf * 0.34,
  };
  const hipJoint: Point = [cx - hip * 0.5, y.crotch - thighHalf * 0.6];
  const knee: Point = [hipJoint[0] + (cx - hipJoint[0]) * 0.14, y.knee];
  const ankle: Point = [knee[0] - 0.5, y.ankle];
  const footHeight = Hpx * PROPORTIONS.footHeight;
  const foot = {
    cx: ankle[0] - legHalf.ankle * 0.4,
    cy: floor - footHeight * 0.5,
    rx: legHalf.ankle * 2.1,
    ry: footHeight * 0.55,
  };

  const measured = Object.fromEntries(
    (Object.keys(MEASUREMENT_BOUNDS) as MeasurementKey[]).map((key) => [key, m[key] !== null]),
  ) as Record<MeasurementKey, boolean>;

  const p = (point: Point): Point => [round(point[0]), round(point[1])];
  return {
    heightCm: m.heightCm,
    drawnHeightCm: H,
    scale,
    cx,
    top: round(top),
    floor,
    head: {
      cx: head.cx,
      cy: round(head.cy),
      rx: round(head.rx),
      ry: round(head.ry),
      chinY: round(head.chinY),
    },
    neck: { top: round(chinY - headHeight * 0.12), base: round(neckBase), half: round(neckHalf) },
    y: Object.fromEntries(Object.entries(y).map(([k, v]) => [k, round(v)])) as AvatarRig['y'],
    half: {
      shoulder: round(shoulder),
      armpit: round(armpit),
      chest: round(chest),
      waist: round(waist),
      hip: round(hip),
    },
    arm: {
      shoulder: p(shoulderJoint),
      elbow: p(elbow),
      wrist: p(wrist),
      half: {
        upper: round(armHalf.upper),
        elbow: round(armHalf.elbow),
        wrist: round(armHalf.wrist),
      },
      hand: { cx: round(hand.cx), cy: round(hand.cy), rx: round(hand.rx), ry: round(hand.ry) },
    },
    leg: {
      hip: p(hipJoint),
      knee: p(knee),
      ankle: p(ankle),
      half: {
        thigh: round(legHalf.thigh),
        knee: round(legHalf.knee),
        calf: round(legHalf.calf),
        ankle: round(legHalf.ankle),
      },
      foot: { cx: round(foot.cx), cy: round(foot.cy), rx: round(foot.rx), ry: round(foot.ry) },
    },
    measured,
  };
}

/** The mirror of a point across the figure's centre line. */
export function mirrorPoint(rig: Pick<AvatarRig, 'cx'>, [x, y]: Point): Point {
  return [2 * rig.cx - x, y];
}
