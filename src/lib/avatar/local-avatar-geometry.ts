import type { AvatarRenderInput } from './avatar-model';

/**
 * The proportions `LocalAvatarRenderer` draws, computed from measurements —
 * pure numbers, no SVG, so they can be tested and reused by a later
 * renderer.
 *
 * This is an illustration, not a body scan. It gets the things a shopper can
 * see change right: taller is taller (every figure shares one scale, so
 * 160 cm and 190 cm look different, not just relabelled), and a wider
 * waist, chest, hip or shoulder measurement widens exactly that part.
 * Circumferences become front-view widths as `C / π × 1.18` — a torso is an
 * ellipse roughly 1.4× wider than it is deep. Anything not measured falls
 * back to a neutral proportion of the waist (the one girth every profile
 * has), never to a guess from the gender field.
 */

export const AVATAR_CANVAS = { width: 240, height: 420, floorY: 404, centerX: 120 } as const;

/** One scale for every figure; heights beyond the drawable range are
 * clamped for drawing only (the label still shows the real value). */
export const PX_PER_CM = 1.6;
const DRAWABLE_HEIGHT_CM = { min: 90, max: 235 };
const NEUTRAL_HEIGHT_CM = 170;
const NEUTRAL_WAIST_CM = 80;
const TORSO_ELLIPSE_FACTOR = 1.18;

export interface AvatarGeometry {
  /** The height the figure represents (unclamped), or null if not entered. */
  heightCm: number | null;
  /** Figure height in px, and the y of the top of the head. */
  figureHeight: number;
  topY: number;
  head: { cx: number; cy: number; rx: number; ry: number };
  neck: { top: number; bottom: number; halfWidth: number };
  /** y positions down the body. */
  y: {
    shoulder: number;
    chest: number;
    waist: number;
    hip: number;
    crotch: number;
    knee: number;
    floor: number;
  };
  /** Half-widths at those positions. */
  half: { shoulder: number; chest: number; waist: number; hip: number };
  limb: { arm: number; wrist: number; thigh: number; ankle: number };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function girthHalfWidth(circumferenceCm: number): number {
  return ((circumferenceCm / Math.PI) * TORSO_ELLIPSE_FACTOR * PX_PER_CM) / 2;
}

export function computeAvatarGeometry(input: AvatarRenderInput): AvatarGeometry {
  const m = input.measurements;
  const heightCm = typeof m.heightCm === 'number' ? m.heightCm : null;
  const drawnHeightCm = clamp(
    heightCm ?? NEUTRAL_HEIGHT_CM,
    DRAWABLE_HEIGHT_CM.min,
    DRAWABLE_HEIGHT_CM.max,
  );
  const figureHeight = drawnHeightCm * PX_PER_CM;
  const floor = AVATAR_CANVAS.floorY;
  const topY = floor - figureHeight;
  const cx = AVATAR_CANVAS.centerX;

  // Vertical landmarks as fractions of stature — standard figure-drawing
  // proportions (about 7.5 heads tall).
  const at = (fraction: number) => topY + figureHeight * fraction;
  const headHeight = figureHeight / 7.5;
  let crotch = at(0.53);
  if (typeof m.inseamCm === 'number') {
    // A measured inseam sets the leg length directly, within reason.
    const leg = clamp(m.inseamCm * PX_PER_CM, figureHeight * 0.4, figureHeight * 0.56);
    crotch = floor - leg;
  }

  const waistCm = typeof m.waistCm === 'number' ? m.waistCm : NEUTRAL_WAIST_CM;
  const chestCm = typeof m.chestCm === 'number' ? m.chestCm : waistCm * 1.12;
  const hipCm = typeof m.hipCm === 'number' ? m.hipCm : waistCm * 1.12;

  const maxHalf = AVATAR_CANVAS.width / 2 - 34;
  const half = {
    waist: clamp(girthHalfWidth(waistCm), 10, maxHalf),
    chest: clamp(girthHalfWidth(chestCm), 10, maxHalf),
    hip: clamp(girthHalfWidth(hipCm), 10, maxHalf),
    shoulder: 0,
  };
  half.shoulder =
    typeof m.shoulderCm === 'number'
      ? clamp((m.shoulderCm * PX_PER_CM) / 2, 12, maxHalf + 6)
      : clamp(half.chest * 1.12, 12, maxHalf + 6);

  // Limb thickness follows build (BMI) gently — a drawing cue only; weight
  // plays no part in sizing.
  const bmi = heightCm && typeof m.weightKg === 'number' ? m.weightKg / (heightCm / 100) ** 2 : 22;
  const build = clamp(bmi / 22, 0.8, 1.6);
  const limb = {
    arm: figureHeight * 0.032 * build,
    wrist: figureHeight * 0.02 * build,
    thigh: Math.min(half.hip * 0.52, figureHeight * 0.05 * build),
    ankle: figureHeight * 0.022 * build,
  };

  return {
    heightCm,
    figureHeight,
    topY,
    head: { cx, cy: topY + headHeight / 2, rx: headHeight * 0.38, ry: headHeight / 2 },
    neck: { top: topY + headHeight * 0.9, bottom: at(0.18) + 2, halfWidth: headHeight * 0.17 },
    y: {
      shoulder: at(0.18),
      chest: at(0.27),
      waist: at(0.4),
      hip: at(0.5),
      crotch,
      knee: crotch + (floor - crotch) * 0.52,
      floor,
    },
    half,
    limb,
  };
}
