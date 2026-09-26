import { mirrorPoint, type AvatarRig, type Point } from './avatar-rig';

/**
 * Path builders the avatar's layers draw with — pure string functions over
 * a rig, so a garment layer (P04) can cut its outline from the same body
 * the skin layer draws, and tests can compare paths directly.
 *
 * Curves are Catmull-Rom splines through the rig's landmarks, converted to
 * cubic Béziers: smooth where a body is smooth, and passing exactly through
 * every measured point — the waist is drawn at the waist's width, not near
 * it. Numbers are rounded to 0.1 so output is stable text.
 */

const n = (value: number) => (Math.round(value * 10) / 10).toString();
const pt = ([x, y]: Point) => `${n(x)} ${n(y)}`;

/** A smooth curve through `points` (open), as path commands *without* the
 * initial move — so callers can chain it after a line. */
export function smoothThrough(points: readonly Point[], tension = 1): string {
  if (points.length < 2) return '';
  const parts: string[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const k = tension / 6;
    const c1: Point = [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
    parts.push(`C ${pt(c1)} ${pt(c2)} ${pt(p2)}`);
  }
  return parts.join(' ');
}

/** A closed smooth shape through `points`. */
export function smoothClosed(points: readonly Point[], tension = 1): string {
  return `M ${pt(points[0]!)} ${smoothThrough(points, tension)} Z`;
}

/**
 * A tapered limb: a chain of joints, each with its half-width, outlined on
 * both sides and capped round at both ends — an arm from shoulder to wrist,
 * a leg from hip to ankle, or a sleeve cut from either.
 */
export function limbOutline(joints: readonly Point[], halfWidths: readonly number[]): string {
  const normals = joints.map((joint, i) => {
    const prev = joints[i - 1] ?? joint;
    const next = joints[i + 1] ?? joint;
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const length = Math.hypot(dx, dy) || 1;
    return [-dy / length, dx / length] as Point;
  });
  const side = (sign: 1 | -1) =>
    joints.map(
      ([x, y], i) =>
        [
          x + normals[i]![0] * halfWidths[i]! * sign,
          y + normals[i]![1] * halfWidths[i]! * sign,
        ] as Point,
    );
  const left = side(1);
  const right = side(-1).reverse();
  const last = joints.length - 1;
  const end = joints[last]!;
  const start = joints[0]!;
  const dir = (a: Point, b: Point) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / length, (b[1] - a[1]) / length] as Point;
  };
  const endDir = dir(joints[last - 1] ?? start, end);
  const startDir = dir(joints[1] ?? end, start);
  // Round caps: a quadratic bulge one half-width beyond each end.
  const endCap: Point = [
    end[0] + endDir[0] * halfWidths[last]! * 1.3,
    end[1] + endDir[1] * halfWidths[last]! * 1.3,
  ];
  const startCap: Point = [
    start[0] + startDir[0] * halfWidths[0]! * 1.3,
    start[1] + startDir[1] * halfWidths[0]! * 1.3,
  ];
  return [
    `M ${pt(left[0]!)}`,
    smoothThrough(left),
    `Q ${pt(endCap)} ${pt(right[0]!)}`,
    smoothThrough(right),
    `Q ${pt(startCap)} ${pt(left[0]!)}`,
    'Z',
  ].join(' ');
}

/** The left half of the torso's edge, neck to crotch, as points. Garments
 * offset these by their ease. */
export function torsoEdge(rig: AvatarRig, ease = 0): Point[] {
  const { cx, half, y, neck } = rig;
  return [
    [cx - neck.half - ease * 0.3, neck.base],
    [cx - half.shoulder * 0.64 - ease * 0.5, y.shoulder - 1],
    [cx - half.shoulder - ease * 0.6, y.shoulder + 5],
    [cx - half.armpit - ease, y.armpit],
    [cx - half.chest - ease, y.chest],
    [cx - half.waist - ease, y.waist],
    [cx - half.hip - ease, y.hip],
    [cx - half.hip * 0.97 - ease, y.crotch],
  ];
}

/** The x of the torso's left edge at height `atY` (linear between the
 * edge's points) — where a hem or a waistband meets the side. */
export function torsoXAt(edge: readonly Point[], atY: number): number {
  for (let i = 0; i < edge.length - 1; i += 1) {
    const [x1, y1] = edge[i]!;
    const [x2, y2] = edge[i + 1]!;
    if (atY >= y1 && atY <= y2) return x1 + ((x2 - x1) * (atY - y1)) / (y2 - y1 || 1);
  }
  return atY < edge[0]![1] ? edge[0]![0] : edge[edge.length - 1]![0];
}

/**
 * A torso-shaped region between two heights — the body itself from neck
 * to crotch, or a garment's body from its neckline to its hem, widened by
 * `ease` units each side. Both sides are the same curve, mirrored.
 */
export function torsoBand(
  rig: AvatarRig,
  {
    from,
    to,
    ease = 0,
    hemCurve = 0,
  }: { from?: number; to: number; ease?: number; hemCurve?: number },
): string {
  const edge = torsoEdge(rig, ease);
  const startY = from ?? edge[0]![1];
  const inside = edge.filter(([, py]) => py > startY + 0.5 && py < to - 0.5);
  const left: Point[] = [[torsoXAt(edge, startY), startY], ...inside, [torsoXAt(edge, to), to]];
  const right = left.map((p) => mirrorPoint(rig, p)).reverse();
  const hemMid: Point = [rig.cx, to + hemCurve];
  return [
    `M ${pt(left[0]!)}`,
    smoothThrough(left),
    `Q ${pt(hemMid)} ${pt(right[0]!)}`,
    smoothThrough(right),
    'Z',
  ].join(' ');
}

/** A path and its mirror image across the centre line, as one string. */
export function mirrored(rig: AvatarRig, build: (mirror: (p: Point) => Point) => string): string {
  return `${build((p) => p)} ${build((p) => mirrorPoint(rig, p))}`;
}
