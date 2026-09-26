import type { ReactNode } from 'react';

import type { FittingResult } from '@/modules/fitting';
import type { AvatarLayer, AvatarScene } from '@/components/storefront/avatar/avatar-layers';
import { girthHalfPx, type AvatarRig, type Point } from '@/components/storefront/avatar/avatar-rig';
import { chainUntil, edgeBand, limbOutline } from '@/components/storefront/avatar/avatar-shapes';
import { armChain, legChain, mirrorChain } from '@/components/storefront/avatar/layers/body-layers';

/**
 * The garment on the avatar (clothing P04): a fitting result turned into
 * avatar layers that take the base outfit's slots over.
 *
 * Not photorealistic, and not pretending to be: it shows *this* garment —
 * its kind, sleeves, neckline, length, pattern and colour — in *this*
 * size, on the customer's own rig. Widths come from the chosen size's chart
 * measurements (a smaller size sits closer, a larger one looser); a size
 * smaller than the body at some point is drawn just over the body there,
 * with strain lines, never inside it. Length and sleeve come from the
 * chart where it has them (a short thobe stops above the ankle, a long one
 * pools at the floor), and from the style's usual length where it does not.
 *
 * Colours are the admin's swatch (data, `#RRGGBB`) or a neutral token; the
 * trim is mixed from the swatch in CSS, so no colour is invented here.
 */

type Measurements = FittingResult['size']['measurements'];

const SLEEVE_EASE_PX = 2;

interface GarmentPaint {
  fill: string;
  trim: string;
  outline: string;
  skin: string;
  patternFill: string | null;
}

function paintOf(result: FittingResult, scene: AvatarScene, patternId: string): GarmentPaint {
  const neutral =
    result.layerKind === 'bottom' ? 'var(--avatar-garment-bottom)' : 'var(--avatar-garment-top)';
  const fill = result.color?.swatchHex ?? neutral;
  return {
    fill,
    trim: `color-mix(in oklch, ${fill} 68%, var(--avatar-feature))`,
    outline: scene.paint.outline,
    skin: scene.paint.skin,
    patternFill: result.style.pattern === 'SOLID' ? null : `url(#${patternId})`,
  };
}

/** A garment's half-width at a body landmark: its own chart girth where the
 * chart has one, else the body plus a small default ease — and never less
 * than the body itself. */
function halfAt(bodyHalf: number, garmentCm: number | undefined, fallbackEasePx: number): number {
  const drawn = typeof garmentCm === 'number' ? girthHalfPx(garmentCm) : bodyHalf + fallbackEasePx;
  return Math.max(bodyHalf + 0.8, drawn);
}

function isTight(result: FittingResult, measurement: string): boolean {
  return (
    result.fit?.areas.some(
      (area) =>
        area.measurement === measurement && (area.fit === 'snug' || area.fit === 'too_tight'),
    ) ?? false
  );
}

/** Where a top or full-length garment ends. */
function hemY(result: FittingResult, rig: AvatarRig): number {
  const { y, floor } = rig;
  const lengthCm = result.size.measurements.lengthCm;
  if (typeof lengthCm === 'number' && result.layerKind !== 'bottom') {
    // Garment length is measured from the high point of the shoulder.
    const start = y.shoulder - 4;
    return Math.min(floor + 1, Math.max(y.waist, start + lengthCm * rig.scale));
  }
  switch (result.style.length) {
    case 'CROPPED':
      return y.waist + 2;
    case 'HIP':
      return y.hip + (y.crotch - y.hip) * 0.45;
    case 'THIGH':
      return y.crotch + (y.knee - y.crotch) * 0.35;
    case 'KNEE':
      return y.knee + 4;
    case 'MIDI':
      return y.knee + (y.ankle - y.knee) * 0.45;
    case 'ANKLE':
      return y.ankle - 2;
    case 'FLOOR':
    default:
      return floor + 1;
  }
}

/** How far down the leg a bottom's legs reach, as a share of hip→ankle. */
function legReach(result: FittingResult, rig: AvatarRig): number {
  const inseam = result.size.measurements.inseamCm;
  const legLength = rig.leg.ankle[1] - rig.leg.hip[1];
  if (typeof inseam === 'number') {
    return Math.min(1.02, Math.max(0.2, (inseam * rig.scale) / (rig.floor - rig.y.crotch)));
  }
  switch (result.style.length) {
    case 'CROPPED':
      return 0.8;
    case 'THIGH':
      return 0.3;
    case 'KNEE':
      return (rig.leg.knee[1] - rig.leg.hip[1] + 6) / legLength;
    default:
      return 1;
  }
}

function sleeveReach(result: FittingResult, rig: AvatarRig): number | null {
  switch (result.style.sleeveLength) {
    case 'SLEEVELESS':
    case null:
      return null;
    case 'SHORT':
      return 0.24;
    case 'THREE_QUARTER':
      return 0.72;
    case 'LONG':
    default: {
      const sleeveCm = result.size.measurements.sleeveCm;
      if (typeof sleeveCm !== 'number') return 1;
      const arm = armChain(rig).joints;
      const armLength = Math.hypot(arm.at(-1)![0] - arm[0]![0], arm.at(-1)![1] - arm[0]![1]);
      return Math.min(1.1, Math.max(0.6, (sleeveCm * rig.scale) / armLength));
    }
  }
}

/** The garment body's left edge, from the neck down to `hem`. */
function bodyEdge(result: FittingResult, rig: AvatarRig, hem: number): Point[] {
  const m: Measurements = result.size.measurements;
  const { cx, half, y, neck } = rig;
  const kind = result.layerKind;
  const loose = result.garmentType === 'ABAYA' ? 12 : result.garmentType === 'HOODIE' ? 5 : 3;
  const chest = halfAt(half.chest, m.chestCm, loose);
  const waist = halfAt(half.waist, m.waistCm ?? (kind === 'full' ? undefined : m.chestCm), loose);
  const hip = halfAt(half.hip, m.hipCm ?? (kind === 'full' ? undefined : m.chestCm), loose + 1);
  const shoulder = Math.max(
    half.shoulder - 1,
    typeof m.shoulderCm === 'number' ? (m.shoulderCm * rig.scale) / 2 : half.shoulder + 1,
  );
  const edge: Point[] = [
    [cx - neck.half - 1.5, neck.base - 1],
    [cx - shoulder * 0.64, y.shoulder - 2],
    [cx - shoulder - 0.5, y.shoulder + 5],
    [cx - Math.max(half.armpit + 1, chest * 0.99), y.armpit],
    [cx - chest, y.chest],
    [cx - Math.max(waist, result.garmentType === 'DRESS' ? half.waist + 1.5 : waist), y.waist],
    [cx - hip, y.hip],
  ];
  if (hem > y.crotch + 2) {
    // Below the hips: a dress flares, an abaya falls wide, a thobe hangs
    // straight.
    const flare = result.garmentType === 'DRESS' ? 11 : result.garmentType === 'ABAYA' ? 16 : 3;
    edge.push([cx - hip - flare * 0.35, y.crotch + 4]);
    edge.push([cx - hip - flare, hem]);
  } else {
    edge.push([cx - hip, Math.max(hem, y.hip + 1)]);
  }
  return edge;
}

function Sleeves({
  rig,
  reach,
  extra,
  paint,
  shade,
}: {
  rig: AvatarRig;
  reach: number;
  extra: number;
  paint: GarmentPaint;
  shade: string;
}) {
  const arm = armChain(rig);
  const sleeve = chainUntil(
    arm.joints,
    arm.widths.map((w, i) => w + SLEEVE_EASE_PX + extra * (i / (arm.widths.length - 1))),
    reach,
  );
  const both = [sleeve, mirrorChain(rig, sleeve)];
  return (
    <>
      {both.map((chain, i) => {
        const d = limbOutline(chain.joints, chain.widths);
        return (
          <g key={i}>
            <path d={d} fill={paint.fill} stroke={paint.outline} />
            {paint.patternFill ? <path d={d} fill={paint.patternFill} /> : null}
            {i === 1 ? <path d={d} fill={shade} /> : null}
          </g>
        );
      })}
    </>
  );
}

function Neckline({
  result,
  rig,
  paint,
}: {
  result: FittingResult;
  rig: AvatarRig;
  paint: GarmentPaint;
}) {
  const { cx, neck } = rig;
  const n = neck.half;
  const base = neck.base;
  const trim = {
    stroke: paint.trim,
    strokeWidth: 1.4,
    fill: 'none',
    style: { stroke: paint.trim },
  };
  switch (result.style.neckline) {
    case 'V_NECK':
      return (
        <path
          data-part="neckline"
          d={`M ${cx - n - 2} ${base - 1} L ${cx} ${base + 16} L ${cx + n + 2} ${base - 1} Z`}
          fill={paint.skin}
        />
      );
    case 'SCOOP':
      return (
        <path
          data-part="neckline"
          d={`M ${cx - n - 5} ${base - 1} Q ${cx} ${base + 14} ${cx + n + 5} ${base - 1} Z`}
          fill={paint.skin}
        />
      );
    case 'COLLAR':
      return (
        <g data-part="neckline">
          <path
            d={`M ${cx - n - 2} ${base - 1} Q ${cx} ${base + 6} ${cx + n + 2} ${base - 1} Z`}
            fill={paint.skin}
          />
          {[-1, 1].map((side) => (
            <path
              key={side}
              d={`M ${cx + side * (n + 2)} ${base - 3} L ${cx + side * 1.5} ${base + 8} L ${cx + side * (n + 6)} ${base + 5} Z`}
              style={{ fill: paint.fill, stroke: paint.trim }}
              strokeWidth={1}
            />
          ))}
          <path d={`M ${cx} ${base + 8} L ${cx} ${rig.y.waist}`} {...trim} />
        </g>
      );
    case 'BAND':
      return (
        <g data-part="neckline">
          <path
            d={`M ${cx - n - 1} ${base - 4} Q ${cx} ${base + 2} ${cx + n + 1} ${base - 4} L ${cx + n + 1} ${base - 1} Q ${cx} ${base + 5} ${cx - n - 1} ${base - 1} Z`}
            style={{ fill: paint.trim }}
          />
          <path d={`M ${cx} ${base + 3} L ${cx} ${rig.y.chest + 8}`} {...trim} />
          {[0, 1, 2].map((i) => (
            <circle
              key={i}
              cx={cx + 2.5}
              cy={base + 8 + i * 8}
              r={1.1}
              style={{ fill: paint.trim }}
            />
          ))}
        </g>
      );
    case 'HOOD':
      return (
        <g data-part="neckline">
          <path
            d={`M ${cx - n - 5} ${base - 3} Q ${cx} ${base + 10} ${cx + n + 5} ${base - 3}`}
            {...trim}
            strokeWidth={3}
          />
          {[-1, 1].map((side) => (
            <path
              key={side}
              d={`M ${cx + side * 4} ${base + 3} L ${cx + side * 5} ${base + 22}`}
              {...trim}
            />
          ))}
        </g>
      );
    case 'CREW':
    default:
      return (
        <path
          data-part="neckline"
          d={`M ${cx - n - 2} ${base - 1} Q ${cx} ${base + 7} ${cx + n + 2} ${base - 1} Z`}
          fill={paint.skin}
        />
      );
  }
}

function PatternDefs({
  id,
  result,
  paint,
}: {
  id: string;
  result: FittingResult;
  paint: GarmentPaint;
}) {
  const style = { fill: paint.trim, stroke: paint.trim };
  let content: ReactNode;
  switch (result.style.pattern) {
    case 'STRIPED':
      content = (
        <rect x={0} y={0} width={8} height={2.6} style={{ fill: paint.trim }} opacity={0.75} />
      );
      break;
    case 'CHECKED':
      content = (
        <>
          <rect x={0} y={0} width={8} height={2} style={{ fill: paint.trim }} opacity={0.55} />
          <rect x={0} y={0} width={2} height={8} style={{ fill: paint.trim }} opacity={0.55} />
        </>
      );
      break;
    case 'DOTTED':
      content = <circle cx={4} cy={4} r={1.1} style={style} />;
      break;
    case 'FLORAL':
      content = (
        <g opacity={0.8}>
          {[0, 1, 2, 3].map((i) => (
            <circle
              key={i}
              cx={4 + Math.cos((i * Math.PI) / 2) * 1.5}
              cy={4 + Math.sin((i * Math.PI) / 2) * 1.5}
              r={1.1}
              style={style}
            />
          ))}
        </g>
      );
      break;
    default:
      return null;
  }
  return (
    <defs>
      <pattern id={id} width={8} height={8} patternUnits="userSpaceOnUse">
        {content}
      </pattern>
    </defs>
  );
}

/** Strain lines where the chosen size is short of room — never colour alone:
 * the fitting panel says it in words too. */
function Strain({ rig, y, paint }: { rig: AvatarRig; y: number; paint: GarmentPaint }) {
  const { cx } = rig;
  return (
    <g data-part="strain" style={{ stroke: paint.trim }} strokeWidth={1} fill="none">
      {[-1, 1].map((side) => (
        <path
          key={side}
          d={`M ${cx + side * 4} ${y - 3} Q ${cx + side * 10} ${y} ${cx + side * 16} ${y - 4}`}
        />
      ))}
    </g>
  );
}

function renderUpper(result: FittingResult, scene: AvatarScene): ReactNode {
  const { rig } = scene;
  const patternId = `${scene.idPrefix}-garment-pattern`;
  const paint = paintOf(result, scene, patternId);
  const hem = hemY(result, rig);
  const edge = bodyEdge(result, rig, hem);
  const body = edgeBand(rig, edge, { to: hem, hemCurve: result.layerKind === 'full' ? 3 : 2 });
  const reach = sleeveReach(result, rig);
  const wideSleeves =
    result.garmentType === 'ABAYA' ? 5 : result.garmentType === 'HOODIE' ? 1.5 : 0;
  const open = result.layerKind === 'outer';
  const full = result.layerKind === 'full';
  const sleeves =
    reach !== null ? (
      <Sleeves
        rig={rig}
        reach={reach}
        extra={wideSleeves}
        paint={paint}
        shade={scene.paint.shade}
      />
    ) : null;
  const { cx } = rig;
  return (
    <g data-part="garment" data-garment={result.garmentType} data-size={result.size.label.en}>
      <PatternDefs id={patternId} result={result} paint={paint} />
      {full ? null : sleeves}
      <path d={body} fill={paint.fill} stroke={paint.outline} />
      {paint.patternFill ? <path d={body} fill={paint.patternFill} /> : null}
      {full ? (
        // A robe falls wider than the hands hang: the arms, in their
        // sleeves, are in front of it.
        <>
          {sleeves}
          {[rig.arm.hand.cx, 2 * rig.cx - rig.arm.hand.cx].map((x) => (
            <ellipse
              key={x}
              cx={x}
              cy={rig.arm.hand.cy}
              rx={rig.arm.hand.rx}
              ry={rig.arm.hand.ry}
              fill={scene.paint.skin}
              stroke={scene.paint.outline}
            />
          ))}
        </>
      ) : null}
      <Neckline result={result} rig={rig} paint={paint} />
      {open || result.garmentType === 'ABAYA' ? (
        <path
          data-part="opening"
          d={`M ${cx} ${rig.neck.base + 6} L ${cx} ${hem}`}
          style={{ stroke: paint.trim }}
          strokeWidth={open ? 1.6 : 1}
        />
      ) : null}
      {result.garmentType === 'CARDIGAN'
        ? [0, 1, 2, 3].map((i) => (
            <circle
              key={i}
              cx={cx + 3}
              cy={rig.y.chest + i * ((rig.y.hip - rig.y.chest) / 3)}
              r={1.4}
              style={{ fill: paint.trim }}
            />
          ))
        : null}
      {result.garmentType === 'HOODIE' ? (
        <path
          data-part="pocket"
          d={`M ${cx - rig.half.waist * 0.7} ${rig.y.waist + 10} L ${cx + rig.half.waist * 0.7} ${rig.y.waist + 10} L ${cx + rig.half.waist * 0.85} ${hem - 6} L ${cx - rig.half.waist * 0.85} ${hem - 6} Z`}
          fill="none"
          style={{ stroke: paint.trim }}
          strokeWidth={1.1}
        />
      ) : null}
      {isTight(result, 'chestCm') ? <Strain rig={rig} y={rig.y.chest + 4} paint={paint} /> : null}
    </g>
  );
}

function renderLower(result: FittingResult, scene: AvatarScene): ReactNode {
  const { rig } = scene;
  const patternId = `${scene.idPrefix}-garment-pattern`;
  const paint = paintOf(result, scene, patternId);
  const m = result.size.measurements;
  const { cx, y, half } = rig;
  const waist = halfAt(half.waist, m.waistCm, 1.5);
  const hip = halfAt(half.hip, m.hipCm, 2.5);

  if (result.garmentType === 'SKIRT') {
    // A skirt's length is measured from the waist, not the shoulder.
    const lengthCm = m.lengthCm;
    const hem =
      typeof lengthCm === 'number'
        ? Math.min(rig.floor, Math.max(y.hip + 4, y.waist + lengthCm * rig.scale))
        : hemY({ ...result, size: { ...result.size, measurements: {} }, layerKind: 'top' }, rig);
    const edge: Point[] = [
      [cx - waist, y.waist],
      [cx - hip, y.hip],
      [cx - hip - 4, y.crotch + 6],
      [cx - hip - 12, hem],
    ];
    const d = edgeBand(rig, edge, { from: y.waist, to: hem, hemCurve: 3 });
    return (
      <g data-part="garment" data-garment={result.garmentType} data-size={result.size.label.en}>
        <PatternDefs id={patternId} result={result} paint={paint} />
        <path d={d} fill={paint.fill} stroke={paint.outline} />
        {paint.patternFill ? <path d={d} fill={paint.patternFill} /> : null}
        {[-0.5, 0, 0.5].map((f) => (
          <path
            key={f}
            d={`M ${cx + f * waist} ${y.waist + 6} L ${cx + f * (hip + 12)} ${hem - 2}`}
            style={{ stroke: paint.trim }}
            strokeWidth={0.8}
            opacity={0.6}
          />
        ))}
      </g>
    );
  }

  const leg = legChain(rig);
  const wide = result.garmentType === 'TROUSERS';
  const legWidths = leg.widths.map(
    (w, i) => w + 1.6 + (wide ? (i / (leg.widths.length - 1)) * 7 : 0) + (hip - half.hip) * 0.5,
  );
  const trouserLeg = chainUntil(leg.joints, legWidths, legReach(result, rig));
  const legs = [trouserLeg, mirrorChain(rig, trouserLeg)];
  const seat = edgeBand(
    rig,
    [
      [cx - waist, y.waist],
      [cx - hip, y.hip],
      [cx - hip * 0.97, y.crotch + 3],
    ],
    { from: y.waist, to: y.crotch + 3, hemCurve: 2 },
  );
  return (
    <g data-part="garment" data-garment={result.garmentType} data-size={result.size.label.en}>
      <PatternDefs id={patternId} result={result} paint={paint} />
      {legs.map((chain, i) => {
        const d = limbOutline(chain.joints, chain.widths);
        return (
          <g key={i}>
            <path d={d} fill={paint.fill} stroke={paint.outline} />
            {paint.patternFill ? <path d={d} fill={paint.patternFill} /> : null}
            {i === 1 ? <path d={d} fill={scene.paint.shade} /> : null}
          </g>
        );
      })}
      <path d={seat} fill={paint.fill} stroke={paint.outline} />
      <path
        data-part="waistband"
        d={`M ${cx - waist} ${y.waist + 3} L ${cx + waist} ${y.waist + 3}`}
        style={{ stroke: paint.trim }}
        strokeWidth={2}
      />
      {result.garmentType === 'JEANS'
        ? [-1, 1].map((side) => (
            <path
              key={side}
              data-part="pocket"
              d={`M ${cx + side * waist * 0.85} ${y.waist + 4} Q ${cx + side * waist * 0.45} ${y.waist + 6} ${cx + side * waist * 0.4} ${y.waist + 14}`}
              fill="none"
              style={{ stroke: paint.trim }}
              strokeWidth={1}
            />
          ))
        : null}
      {isTight(result, 'waistCm') ? <Strain rig={rig} y={y.waist + 8} paint={paint} /> : null}
    </g>
  );
}

/** The avatar layers for a fitting result — what the renderer's `layers`
 * prop takes. */
export function garmentLayers(result: FittingResult): AvatarLayer[] {
  const id = `garment:${result.garmentType}:${result.size.sizeId}`;
  switch (result.layerKind) {
    case 'bottom':
      return [{ id, slot: 'bottom', render: (scene) => renderLower(result, scene) }];
    case 'outer':
      return [{ id, slot: 'outerwear', render: (scene) => renderUpper(result, scene) }];
    case 'full':
      return [
        { id, slot: 'top', replaces: ['bottom'], render: (scene) => renderUpper(result, scene) },
      ];
    case 'top':
    default: {
      const layers: AvatarLayer[] = [
        { id, slot: 'top', render: (scene) => renderUpper(result, scene) },
      ];
      if (result.style.neckline === 'HOOD') {
        layers.push({
          id: `${id}:hood`,
          slot: 'back',
          render: (scene) => {
            const { cx, cy, rx, ry } = scene.rig.head;
            const fill = result.color?.swatchHex ?? 'var(--avatar-garment-top)';
            return (
              <path
                data-part="hood"
                d={`M ${cx - rx * 1.5} ${scene.rig.neck.base + 2} Q ${cx - rx * 1.7} ${cy - ry * 1.3} ${cx} ${cy - ry * 1.35} Q ${cx + rx * 1.7} ${cy - ry * 1.3} ${cx + rx * 1.5} ${scene.rig.neck.base + 2} Z`}
                fill={fill}
                stroke={scene.paint.outline}
              />
            );
          },
        });
      }
      return layers;
    }
  }
}
