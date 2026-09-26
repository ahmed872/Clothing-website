import { useId } from 'react';

import { AVATAR_CANVAS, computeAvatarGeometry } from '@/lib/avatar/local-avatar-geometry';

import type { AvatarRendererProps } from './avatar-types';

/**
 * The P01 avatar — a flat SVG figure with no layers — kept as the `basic`
 * renderer: a second, much simpler implementation of the same contract,
 * which is what proves the renderer seam is real (the page switches
 * between them by kind, not by component). It ignores garment `layers`.
 *
 * Like every renderer: local, no network, no model, no photo; anything
 * unset drawn neutrally; every colour a design token; `data-*` attributes
 * on the root say what was drawn.
 */

const slug = (value: string) => value.toLowerCase().replaceAll('_', '-');
const token = (group: string, value: string | null, fallback: string) =>
  value ? `var(--avatar-${group}-${slug(value)})` : `var(--avatar-${group}-${fallback})`;

export function BasicAvatarRenderer({
  input,
  title,
  description,
  heightLabel,
  direction,
}: AvatarRendererProps) {
  const titleId = useId();
  const descId = useId();
  const g = computeAvatarGeometry(input);
  const a = input.appearance;
  const { cx, cy, rx, ry } = g.head;
  const c = AVATAR_CANVAS.centerX;
  const mirror = (x: number) => 2 * c - x;

  const skin = token('skin', a.skinTone, 'unset');
  const hair = token('hair', a.hairColor, 'unset');
  const outline = 'var(--avatar-outline)';

  // Torso silhouette, left side then the mirrored right side.
  const torsoSide = [
    [c - g.neck.halfWidth, g.y.shoulder - 3],
    [c - g.half.shoulder, g.y.shoulder + 6],
    [c - g.half.chest, g.y.chest],
    [c - g.half.waist, g.y.waist],
    [c - g.half.hip, g.y.hip],
    [c - g.half.hip + 2, g.y.crotch],
  ] as const;
  const torsoPath = (untilY: number, fromY = -Infinity) => {
    const left = torsoSide.filter(([, y]) => y >= fromY && y <= untilY + 0.01);
    const leftXAt = (y: number) => {
      // Linear interpolation along the left edge, for a clean cut line.
      for (let i = 0; i < torsoSide.length - 1; i += 1) {
        const [x1, y1] = torsoSide[i]!;
        const [x2, y2] = torsoSide[i + 1]!;
        if (y >= y1 && y <= y2) return x1 + ((x2 - x1) * (y - y1)) / (y2 - y1 || 1);
      }
      return c - g.half.hip;
    };
    const points: [number, number][] = [
      ...(fromY > -Infinity ? [[leftXAt(fromY), fromY] as [number, number]] : []),
      ...left.map(([x, y]) => [x, y] as [number, number]),
      [leftXAt(untilY), untilY],
    ];
    const right = [...points].reverse().map(([x, y]) => [mirror(x), y] as [number, number]);
    return `M ${[...points, ...right].map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')} Z`;
  };

  // Limbs as rounded strokes: joint positions, left side.
  // Tucked inside the shoulder line, so the arm's rounded top sits under
  // the shoulder rather than above it.
  const shoulderJoint = [
    c - g.half.shoulder + g.limb.arm * 0.95,
    g.y.shoulder + g.limb.arm * 1.5,
  ] as const;
  const elbow = [c - Math.max(g.half.chest, g.half.waist) - g.limb.arm - 2, g.y.waist - 4] as const;
  const wrist = [
    c - Math.max(g.half.hip, g.half.waist) - g.limb.wrist - 5,
    g.y.crotch - 6,
  ] as const;
  const hipJoint = [c - g.half.hip + g.limb.thigh * 0.95, g.y.crotch - g.limb.thigh * 0.5] as const;
  const knee = [c - Math.max(g.half.hip * 0.5, g.limb.thigh) - 2, g.y.knee] as const;
  const ankle = [
    c - Math.max(g.half.hip * 0.45, g.limb.thigh * 0.8) - 2,
    g.y.floor - g.limb.ankle - 2,
  ] as const;
  const seg = (p: readonly [number, number], q: readonly [number, number]) =>
    `M ${p[0].toFixed(1)} ${p[1].toFixed(1)} L ${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
  const mirrored = (p: readonly [number, number]) => [mirror(p[0]), p[1]] as const;
  /** A limb and its mirror, with a faint outline so it reads on any
   * background. `butt` ends suit a garment edge (a sleeve or trouser hem);
   * skin uses rounded joints. */
  const limb = (
    p: readonly [number, number],
    q: readonly [number, number],
    width: number,
    color: string,
    cap: 'round' | 'butt' = 'round',
  ) => (
    <>
      {[seg(p, q), seg(mirrored(p), mirrored(q))].map((d) => (
        <path
          key={`o-${d}`}
          d={d}
          stroke={outline}
          strokeWidth={width + 2}
          strokeLinecap={cap}
          fill="none"
        />
      ))}
      {[seg(p, q), seg(mirrored(p), mirrored(q))].map((d) => (
        <path
          key={`f-${d}`}
          d={d}
          stroke={color}
          strokeWidth={width}
          strokeLinecap={cap}
          fill="none"
        />
      ))}
    </>
  );

  const topHem = g.y.waist + (g.y.hip - g.y.waist) * 0.7;
  const shortsTop = g.y.waist + (g.y.hip - g.y.waist) * 0.55;
  const midThigh = [
    hipJoint[0] + (knee[0] - hipJoint[0]) * 0.45,
    hipJoint[1] + (knee[1] - hipJoint[1]) * 0.45,
  ] as const;
  const sleeveEnd = [
    shoulderJoint[0] + (elbow[0] - shoulderJoint[0]) * 0.45,
    shoulderJoint[1] + (elbow[1] - shoulderJoint[1]) * 0.45,
  ] as const;

  // Hair: a cap over the crown, plus a back layer whose length follows the
  // style. Drawn only when a style is chosen.
  const cap = `M ${cx - rx * 1.06} ${cy - ry * 0.05} Q ${cx - rx * 1.12} ${cy - ry * 1.28} ${cx} ${cy - ry * 1.14} Q ${cx + rx * 1.12} ${cy - ry * 1.28} ${cx + rx * 1.06} ${cy - ry * 0.05} Q ${cx + rx * 0.72} ${cy - ry * 0.56} ${cx} ${cy - ry * 0.62} Q ${cx - rx * 0.72} ${cy - ry * 0.56} ${cx - rx * 1.06} ${cy - ry * 0.05} Z`;
  const backLayer = (bottom: number, width: number, wavy = false) => {
    const w = rx * width;
    const edge = wavy
      ? `Q ${cx + w * 0.5} ${bottom + 8} ${cx} ${bottom} Q ${cx - w * 0.5} ${bottom - 8} ${cx - w} ${bottom}`
      : `Q ${cx} ${bottom + 6} ${cx - w} ${bottom}`;
    return `M ${cx - w} ${cy - ry * 0.2} Q ${cx - w} ${cy - ry * 1.3} ${cx} ${cy - ry * 1.2} Q ${cx + w} ${cy - ry * 1.3} ${cx + w} ${cy - ry * 0.2} L ${cx + w} ${bottom} ${edge} Z`;
  };
  const curls = Array.from({ length: 9 }, (_, i) => {
    const angle = Math.PI * (1.05 + (i / 8) * 0.9);
    return { x: cx + Math.cos(angle) * rx * 1.02, y: cy + Math.sin(angle) * ry * 0.95 };
  });

  const style = a.hairStyle;
  const covered = style === 'COVERED';
  const hairBack =
    style === 'LONG'
      ? backLayer(g.y.chest, 1.25)
      : style === 'STRAIGHT'
        ? backLayer(g.y.shoulder + 10, 1.15)
        : style === 'WAVY'
          ? backLayer(g.y.shoulder + 8, 1.22, true)
          : style === 'MEDIUM'
            ? backLayer(cy + ry * 0.8, 1.12)
            : null;

  // A head covering: one shape around the head and over the shoulders, with
  // the face left open (even-odd fill).
  const coveringOuter = `M ${cx} ${cy - ry * 1.3} Q ${cx + rx * 1.5} ${cy - ry * 1.2} ${cx + rx * 1.35} ${cy + ry * 0.5} Q ${cx + g.half.shoulder * 0.7} ${g.y.shoulder + 4} ${cx + g.half.shoulder * 0.9} ${g.y.chest} L ${cx - g.half.shoulder * 0.9} ${g.y.chest} Q ${cx - g.half.shoulder * 0.7} ${g.y.shoulder + 4} ${cx - rx * 1.35} ${cy + ry * 0.5} Q ${cx - rx * 1.5} ${cy - ry * 1.2} ${cx} ${cy - ry * 1.3} Z`;
  const faceOpening = `M ${cx} ${cy - ry * 0.78} A ${rx * 0.88} ${ry * 0.86} 0 1 0 ${cx} ${cy + ry * 0.94} A ${rx * 0.88} ${ry * 0.86} 0 1 0 ${cx} ${cy - ry * 0.78} Z`;

  const facialHairPath =
    a.facialHair === 'SHORT_BEARD' || a.facialHair === 'LONG_BEARD'
      ? `M ${cx - rx * 0.96} ${cy + ry * 0.08} Q ${cx - rx * 0.9} ${cy + ry * (a.facialHair === 'LONG_BEARD' ? 1.55 : 1.08)} ${cx} ${cy + ry * (a.facialHair === 'LONG_BEARD' ? 1.6 : 1.1)} Q ${cx + rx * 0.9} ${cy + ry * (a.facialHair === 'LONG_BEARD' ? 1.55 : 1.08)} ${cx + rx * 0.96} ${cy + ry * 0.08} Q ${cx + rx * 0.62} ${cy + ry * 0.36} ${cx} ${cy + ry * 0.74} Q ${cx - rx * 0.62} ${cy + ry * 0.36} ${cx - rx * 0.96} ${cy + ry * 0.08} Z`
      : null;
  const mustache =
    a.facialHair === 'MUSTACHE' || a.facialHair === 'SHORT_BEARD' || a.facialHair === 'LONG_BEARD'
      ? `M ${cx - rx * 0.36} ${cy + ry * 0.42} Q ${cx} ${cy + ry * 0.24} ${cx + rx * 0.36} ${cy + ry * 0.42} Q ${cx} ${cy + ry * 0.34} ${cx - rx * 0.36} ${cy + ry * 0.42} Z`
      : null;

  const eyeY = cy + ry * 0.02;
  const eyeDx = rx * 0.38;
  const frame = token('frame', a.glassesFrameColor, 'black');
  const lensW = rx * 0.3;
  const lensH = ry * 0.19;
  const lens = (ex: number) => {
    switch (a.glassesStyle) {
      case 'RECTANGULAR':
        return (
          <rect x={ex - lensW} y={eyeY - lensH} width={lensW * 2} height={lensH * 2} rx={1.5} />
        );
      case 'AVIATOR':
        return (
          <path
            d={`M ${ex - lensW} ${eyeY - lensH} L ${ex + lensW} ${eyeY - lensH} Q ${ex + lensW * 1.05} ${eyeY + lensH * 1.6} ${ex} ${eyeY + lensH * 1.4} Q ${ex - lensW * 1.05} ${eyeY + lensH * 1.4} ${ex - lensW} ${eyeY - lensH} Z`}
          />
        );
      case 'CAT_EYE':
        return (
          <path
            d={`M ${ex - lensW * 1.1} ${eyeY - lensH * 1.3} Q ${ex} ${eyeY - lensH * 0.9} ${ex + lensW * 1.1} ${eyeY - lensH * 1.3} Q ${ex + lensW} ${eyeY + lensH * 1.2} ${ex} ${eyeY + lensH} Q ${ex - lensW} ${eyeY + lensH * 1.2} ${ex - lensW * 1.1} ${eyeY - lensH * 1.3} Z`}
          />
        );
      default:
        return <circle cx={ex} cy={eyeY} r={lensW * 0.95} />;
    }
  };

  const heightTickLabel = [50, 100, 150, 200];

  return (
    <svg
      viewBox={`0 0 ${AVATAR_CANVAS.width} ${AVATAR_CANVAS.height}`}
      role="img"
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="h-auto w-full"
      data-renderer="basic"
      data-height-cm={g.heightCm ?? ''}
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
        <line x1={14} y1={AVATAR_CANVAS.floorY} x2={14} y2={AVATAR_CANVAS.floorY - 235 * 1.6} />
        {heightTickLabel.map((cm) => {
          const y = AVATAR_CANVAS.floorY - cm * 1.6;
          return (
            <g key={cm}>
              <line x1={10} y1={y} x2={18} y2={y} />
              <text x={22} y={y + 3} stroke="none">
                {cm}
              </text>
            </g>
          );
        })}
        {g.heightCm !== null ? (
          <>
            <line
              x1={14}
              y1={g.topY}
              x2={c + g.half.shoulder + 6}
              y2={g.topY}
              strokeDasharray="3 3"
            />
            <text
              x={AVATAR_CANVAS.width - 6}
              y={g.topY - 5}
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

      <ellipse
        cx={c}
        cy={AVATAR_CANVAS.floorY + 3}
        rx={g.half.hip + 18}
        ry={5}
        fill="var(--avatar-shadow)"
      />

      {covered ? null : hairBack ? <path d={hairBack} fill={hair} stroke={outline} /> : null}
      {covered
        ? null
        : style === 'CURLY'
          ? curls.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={rx * 0.42} fill={hair} stroke={outline} />
            ))
          : null}

      {/* Legs, torso, shorts, arms, top. */}
      {limb(hipJoint, knee, g.limb.thigh * 2, skin)}
      {limb(knee, ankle, g.limb.ankle * 2.6, skin)}
      <ellipse
        cx={ankle[0] - 3}
        cy={g.y.floor - 2}
        rx={g.limb.ankle * 2}
        ry={g.limb.ankle}
        fill="var(--avatar-garment-shoe)"
      />
      <ellipse
        cx={mirror(ankle[0] - 3)}
        cy={g.y.floor - 2}
        rx={g.limb.ankle * 2}
        ry={g.limb.ankle}
        fill="var(--avatar-garment-shoe)"
      />
      <path d={torsoPath(g.y.crotch)} fill={skin} stroke={outline} />
      <path
        d={torsoPath(g.y.crotch, shortsTop)}
        fill="var(--avatar-garment-bottom)"
        stroke={outline}
      />
      {limb(hipJoint, midThigh, g.limb.thigh * 2 + 2, 'var(--avatar-garment-bottom)', 'butt')}
      {limb(shoulderJoint, elbow, g.limb.arm * 2, skin)}
      {limb(elbow, wrist, g.limb.wrist * 2.4, skin)}
      <path d={torsoPath(topHem)} fill="var(--avatar-garment-top)" stroke={outline} />
      {limb(shoulderJoint, sleeveEnd, g.limb.arm * 2 + 2, 'var(--avatar-garment-top)', 'butt')}

      {/* Neck and head. */}
      <rect
        x={c - g.neck.halfWidth}
        y={g.neck.top}
        width={g.neck.halfWidth * 2}
        height={Math.max(2, g.neck.bottom - g.neck.top)}
        fill={skin}
      />
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={skin} stroke={outline} />
      <circle cx={cx - eyeDx} cy={eyeY} r={rx * 0.09} fill="var(--avatar-feature)" />
      <circle cx={cx + eyeDx} cy={eyeY} r={rx * 0.09} fill="var(--avatar-feature)" />
      <path
        d={`M ${cx - rx * 0.22} ${cy + ry * 0.5} Q ${cx} ${cy + ry * 0.62} ${cx + rx * 0.22} ${cy + ry * 0.5}`}
        stroke="var(--avatar-feature)"
        strokeWidth={1.2}
        strokeLinecap="round"
        fill="none"
      />

      {facialHairPath ? <path d={facialHairPath} fill={hair} opacity={0.92} /> : null}
      {mustache ? <path d={mustache} fill={hair} /> : null}

      {covered ? (
        <path
          d={`${coveringOuter} ${faceOpening}`}
          fillRule="evenodd"
          fill="var(--avatar-covering)"
          stroke={outline}
        />
      ) : style && style !== 'CURLY' ? (
        <path d={cap} fill={hair} stroke={outline} opacity={style === 'BUZZ' ? 0.6 : 1} />
      ) : style === 'CURLY' ? (
        <path d={cap} fill={hair} />
      ) : null}

      {a.wearsGlasses ? (
        <g stroke={frame} strokeWidth={Math.max(1.2, rx * 0.08)} fill="var(--avatar-lens)">
          {lens(cx - eyeDx)}
          {lens(cx + eyeDx)}
          <path
            d={`M ${cx - eyeDx + lensW * 0.9} ${eyeY} Q ${cx} ${eyeY - lensH * 0.6} ${cx + eyeDx - lensW * 0.9} ${eyeY}`}
            fill="none"
          />
          <path d={`M ${cx - eyeDx - lensW} ${eyeY} L ${cx - rx * 0.98} ${eyeY - 1}`} fill="none" />
          <path d={`M ${cx + eyeDx + lensW} ${eyeY} L ${cx + rx * 0.98} ${eyeY - 1}`} fill="none" />
        </g>
      ) : null}
    </svg>
  );
}
