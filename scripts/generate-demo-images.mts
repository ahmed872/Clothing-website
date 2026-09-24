/**
 * Draws the demo catalog's product photos: one illustration per product
 * colour, plus the homepage hero, written as WebP into
 * `scripts/data/demo-images/`. `db:seed-demo-catalog` uploads those files
 * through the configured storage provider, so the demo store works with no
 * network access and no third-party image host.
 *
 * Illustrations rather than photographs on purpose: a demo catalog has no
 * real photos to use, and borrowing stock photography would show garments
 * that do not match the product names, colours and prices beside them. Each
 * image here is drawn from the same `demo-catalog.json` row the product is,
 * so the black T-shirt is black and the striped one has stripes.
 *
 * The images are committed; run this only after changing a product's
 * garment or colours:
 *
 *   pnpm demo:images
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

interface DemoColor {
  en: string;
  hex: string;
}

interface DemoProduct {
  slug: string;
  garment: string;
  colors: DemoColor[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog: { products: DemoProduct[] } = JSON.parse(
  readFileSync(path.join(here, 'data/demo-catalog.json'), 'utf-8'),
);
const outDir = path.join(here, 'data/demo-images');

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

function parseHex(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b]
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Negative `amount` mixes toward black, positive toward white. */
function shade(hex: string, amount: number): string {
  const rgb = parseHex(hex);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  return toHex(rgb.map((c) => c + (target - c) * t) as [number, number, number]);
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => c / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** A tone that reads against the garment: lighter on dark cloth, darker on light. */
function contrastTone(hex: string, amount: number): string {
  return luminance(hex) < 0.22 ? shade(hex, amount) : shade(hex, -amount);
}

/** Deterministic, so re-running the generator redraws identical files. */
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function mirrorX(d: string): string {
  // Mirrors every x coordinate of an absolute-command path around x = 500.
  let isX = true;
  return d.replace(/-?\d+(\.\d+)?/g, (match) => {
    const value = Number(match);
    const out = isX ? 1000 - value : value;
    isX = !isX;
    return String(out);
  });
}

// ---------------------------------------------------------------------------
// Garments
//
// Each garment is drawn on a 1000×1000 canvas: `parts` are its filled
// silhouette pieces (back to front), `details` the seams, stitches, buttons
// and trims drawn over them, and `floor` the y of its lowest point, for the
// shadow underneath.
// ---------------------------------------------------------------------------

interface Garment {
  parts: string[];
  details: string;
  floor: number;
  pattern?: 'stripes' | 'florals' | 'knit';
}

interface Palette {
  base: string;
  seam: string;
  stitch: string;
  inner: string;
  trim: string;
  highlight: string;
}

function palette(hex: string): Palette {
  return {
    base: hex,
    seam: shade(hex, -0.24),
    stitch: contrastTone(hex, 0.28),
    inner: shade(hex, -0.38),
    trim: shade(hex, -0.08),
    highlight: contrastTone(hex, 0.16),
  };
}

const line = (d: string, color: string, width = 3, extra = '') =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
const stitchLine = (d: string, color: string) =>
  line(d, color, 2.5, 'stroke-dasharray="7 6" opacity="0.8"');
const fold = (d: string, color: string) => line(d, color, 7, 'opacity="0.22"');
const shape = (d: string, fill: string, stroke: string) =>
  `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/>`;
const button = (x: number, y: number, color: string, r = 8) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" stroke="${shade(color, -0.3)}" stroke-width="2"/>` +
  `<circle cx="${x - r * 0.3}" cy="${y}" r="1.6" fill="${shade(color, -0.45)}"/>` +
  `<circle cx="${x + r * 0.3}" cy="${y}" r="1.6" fill="${shade(color, -0.45)}"/>`;

function ribLines(
  x1: number,
  x2: number,
  y1: number,
  y2: number,
  color: string,
  step = 12,
): string {
  let out = '';
  for (let x = x1 + step / 2; x < x2; x += step) {
    out += line(`M ${x} ${y1 + 4} L ${x} ${y2 - 4}`, color, 2, 'opacity="0.45"');
  }
  return out;
}

function mirrored(d: string, fill: string, stroke: string): string {
  return shape(d, fill, stroke) + shape(mirrorX(d), fill, stroke);
}

function tshirt(p: Palette): Garment {
  const neckFront = 'M 385 205 C 420 250, 580 250, 615 205';
  return {
    parts: [
      `${neckFront} L 735 245 L 845 380 L 760 440 L 700 375 L 705 830 C 570 842, 430 842, 295 830 L 300 375 L 240 440 L 155 380 L 265 245 Z`,
    ],
    details:
      shape(`${neckFront} C 580 188, 420 188, 385 205 Z`, p.inner, p.seam) +
      line(neckFront, p.trim, 16) +
      line(neckFront, p.seam, 2) +
      stitchLine('M 838 363 L 753 423', p.stitch) +
      stitchLine('M 162 363 L 247 423', p.stitch) +
      stitchLine('M 297 812 C 430 824, 570 824, 703 812', p.stitch) +
      line('M 700 375 Q 690 330 735 245', p.seam, 2, 'opacity="0.5"') +
      line('M 300 375 Q 310 330 265 245', p.seam, 2, 'opacity="0.5"') +
      fold('M 420 520 Q 440 650 410 780', p.seam) +
      fold('M 590 540 Q 575 660 600 790', p.seam) +
      fold('M 305 380 Q 335 405 350 445', p.seam),
    floor: 840,
  };
}

function oversizedTee(p: Palette): Garment {
  const neckFront = 'M 400 200 C 435 245, 565 245, 600 200';
  return {
    parts: [
      `${neckFront} L 770 250 L 880 470 L 790 510 L 730 420 L 735 820 C 580 832, 420 832, 265 820 L 270 420 L 210 510 L 120 470 L 230 250 Z`,
    ],
    details:
      shape(`${neckFront} C 565 184, 435 184, 400 200 Z`, p.inner, p.seam) +
      line(neckFront, p.trim, 18) +
      line(neckFront, p.seam, 2) +
      line('M 770 250 Q 745 330 730 420', p.seam, 2.5, 'opacity="0.6"') +
      line('M 230 250 Q 255 330 270 420', p.seam, 2.5, 'opacity="0.6"') +
      stitchLine('M 866 455 L 780 492', p.stitch) +
      stitchLine('M 134 455 L 220 492', p.stitch) +
      stitchLine('M 268 802 C 420 814, 580 814, 732 802', p.stitch) +
      fold('M 400 480 Q 425 640 395 790', p.seam) +
      fold('M 610 470 Q 590 630 615 790', p.seam) +
      fold('M 500 600 Q 505 700 495 800', p.seam),
    floor: 830,
  };
}

function shirt(p: Palette): Garment {
  const sleeve =
    'M 300 245 L 232 280 C 200 420, 175 560, 160 690 L 228 712 C 250 590, 280 470, 312 380 Z';
  const cuff = 'M 160 690 L 228 712 L 220 758 L 150 736 Z';
  let buttons = '';
  for (const y of [330, 420, 510, 600, 690, 780]) buttons += button(500, y, p.trim, 7);
  return {
    parts: [
      sleeve,
      mirrorX(sleeve),
      cuff,
      mirrorX(cuff),
      'M 300 245 L 420 212 L 500 262 L 580 212 L 700 245 L 712 850 C 640 870, 560 862, 500 878 C 440 862, 360 870, 288 850 Z',
    ],
    details:
      mirrored(cuff, p.trim, p.seam) +
      shape(
        'M 418 205 C 450 190, 550 190, 582 205 L 580 222 C 550 212, 450 212, 420 222 Z',
        p.inner,
        p.seam,
      ) +
      mirrored('M 420 206 L 500 262 L 468 312 L 398 262 Z', p.base, p.seam) +
      button(452, 290, p.trim, 5) +
      button(548, 290, p.trim, 5) +
      shape('M 486 262 L 514 262 L 514 872 L 486 872 Z', p.base, p.seam) +
      buttons +
      shape('M 555 355 L 640 355 L 640 440 L 597 452 L 555 440 Z', p.base, p.seam) +
      stitchLine('M 555 368 L 640 368', p.stitch) +
      fold('M 220 420 Q 238 470 215 520', p.seam) +
      fold('M 780 420 Q 762 470 785 520', p.seam) +
      fold('M 400 480 Q 420 640 395 820', p.seam) +
      fold('M 610 500 Q 595 650 615 820', p.seam),
    floor: 878,
  };
}

function thobe(p: Palette): Garment {
  const sleeve =
    'M 335 225 L 262 262 C 235 420, 215 580, 200 735 L 268 752 C 285 600, 305 470, 340 380 Z';
  const cuff = 'M 200 735 L 268 752 L 262 792 L 193 776 Z';
  let buttons = '';
  for (const y of [248, 310, 372, 434]) buttons += button(500, y, p.trim, 5);
  return {
    parts: [
      sleeve,
      mirrorX(sleeve),
      cuff,
      mirrorX(cuff),
      'M 335 225 L 450 200 L 550 200 L 665 225 L 702 910 C 600 924, 400 924, 298 910 Z',
    ],
    details:
      mirrored(cuff, p.trim, p.seam) +
      shape(
        'M 445 176 C 470 168, 530 168, 555 176 L 558 208 C 530 216, 470 216, 442 208 Z',
        p.trim,
        p.seam,
      ) +
      shape(
        'M 452 180 C 480 174, 520 174, 548 180 L 548 188 C 520 182, 480 182, 452 188 Z',
        p.inner,
        p.seam,
      ) +
      shape('M 490 212 L 510 212 L 510 470 L 490 470 Z', p.base, p.seam) +
      buttons +
      shape('M 585 300 L 640 300 L 640 362 L 585 362 Z', p.base, p.seam) +
      line('M 342 560 L 352 660', p.seam, 4) +
      line('M 658 560 L 648 660', p.seam, 4) +
      stitchLine('M 300 894 C 400 906, 600 906, 700 894', p.stitch) +
      fold('M 420 480 Q 410 700 400 900', p.seam) +
      fold('M 580 480 Q 590 700 600 900', p.seam) +
      fold('M 230 450 Q 245 520 225 600', p.seam) +
      fold('M 770 450 Q 755 520 775 600', p.seam),
    floor: 924,
  };
}

function hoodie(p: Palette): Garment {
  const sleeve =
    'M 305 270 L 240 300 C 210 440, 190 580, 178 700 L 245 718 C 265 600, 290 480, 318 400 Z';
  const cuff = 'M 178 700 L 245 718 L 238 772 L 170 755 Z';
  const pocket = 'M 470 590 L 470 770 L 330 770 L 355 640 Z';
  return {
    parts: [
      'M 380 250 C 360 160, 420 110, 500 108 C 580 110, 640 160, 620 250 Z',
      sleeve,
      mirrorX(sleeve),
      cuff,
      mirrorX(cuff),
      'M 305 270 L 420 245 C 450 300, 550 300, 580 245 L 695 270 L 705 800 L 295 800 Z',
      'M 295 800 L 705 800 L 705 850 L 295 850 Z',
    ],
    details:
      shape(
        'M 420 245 C 405 170, 450 140, 500 138 C 550 140, 595 170, 580 245 C 550 300, 450 300, 420 245 Z',
        p.inner,
        p.seam,
      ) +
      line('M 420 245 C 405 170, 450 140, 500 138 C 550 140, 595 170, 580 245', p.base, 14) +
      line('M 420 245 C 405 170, 450 140, 500 138 C 550 140, 595 170, 580 245', p.seam, 2) +
      mirrored(cuff, p.trim, p.seam) +
      ribLines(170, 250, 700, 775, p.seam) +
      ribLines(750, 830, 700, 775, p.seam) +
      shape('M 295 800 L 705 800 L 705 850 L 295 850 Z', p.trim, p.seam) +
      ribLines(295, 705, 800, 850, p.seam) +
      line('M 500 285 L 500 850', p.inner, 6) +
      line('M 500 285 L 500 850', '#B9BABE', 7, 'stroke-dasharray="2 4"') +
      '<rect x="492" y="300" width="16" height="36" rx="4" fill="#CFD0D4" stroke="#8E9096" stroke-width="2"/>' +
      line('M 468 290 C 466 330, 472 370, 466 410', '#EDEBE6', 5) +
      line('M 532 290 C 534 330, 528 370, 534 410', '#EDEBE6', 5) +
      '<rect x="461" y="406" width="10" height="20" rx="3" fill="#C9C7C1"/>' +
      '<rect x="529" y="406" width="10" height="20" rx="3" fill="#C9C7C1"/>' +
      mirrored(pocket, p.base, p.seam) +
      stitchLine('M 458 598 L 458 758 L 342 758', p.stitch) +
      stitchLine('M 542 598 L 542 758 L 658 758', p.stitch) +
      fold('M 250 430 Q 265 480 245 530', p.seam) +
      fold('M 750 430 Q 735 480 755 530', p.seam),
    floor: 850,
  };
}

function bomber(p: Palette): Garment {
  const sleeve =
    'M 300 265 L 236 296 C 205 440, 186 580, 176 700 L 244 718 C 262 600, 286 480, 314 400 Z';
  const cuff = 'M 176 700 L 244 718 L 236 772 L 168 755 Z';
  return {
    parts: [
      sleeve,
      mirrorX(sleeve),
      cuff,
      mirrorX(cuff),
      'M 300 265 L 420 240 C 450 262, 550 262, 580 240 L 700 265 L 712 790 L 288 790 Z',
      'M 288 790 L 712 790 L 712 850 L 288 850 Z',
    ],
    details:
      shape(
        'M 415 215 C 450 200, 550 200, 585 215 C 550 230, 450 230, 415 215 Z',
        p.inner,
        p.seam,
      ) +
      shape(
        'M 420 240 C 450 262, 550 262, 580 240 L 585 215 C 550 238, 450 238, 415 215 Z',
        p.trim,
        p.seam,
      ) +
      mirrored(cuff, p.trim, p.seam) +
      ribLines(168, 248, 700, 775, p.seam) +
      ribLines(752, 832, 700, 775, p.seam) +
      shape('M 288 790 L 712 790 L 712 850 L 288 850 Z', p.trim, p.seam) +
      ribLines(288, 712, 790, 850, p.seam) +
      line('M 500 250 L 500 850', p.inner, 6) +
      line('M 500 250 L 500 850', '#B9BABE', 7, 'stroke-dasharray="2 4"') +
      '<rect x="492" y="262" width="16" height="36" rx="4" fill="#CFD0D4" stroke="#8E9096" stroke-width="2"/>' +
      shape('M 722 385 L 772 395 L 762 455 L 712 445 Z', p.base, p.seam) +
      line('M 724 398 L 768 406', '#B9BABE', 4) +
      line('M 340 610 L 392 520', p.inner, 9) +
      line('M 660 610 L 608 520', p.inner, 9) +
      fold('M 250 430 Q 265 480 245 530', p.seam) +
      fold('M 750 430 Q 735 480 755 530', p.seam) +
      fold('M 400 640 Q 420 700 405 770', p.seam) +
      fold('M 600 640 Q 580 700 595 770', p.seam),
    floor: 850,
  };
}

function cardigan(p: Palette): Garment {
  const sleeve =
    'M 300 245 L 234 280 C 204 420, 182 560, 168 690 L 236 710 C 256 590, 284 470, 314 385 Z';
  const cuff = 'M 168 690 L 236 710 L 228 768 L 158 748 Z';
  let buttons = '';
  for (const y of [530, 605, 680, 755]) buttons += button(500, y, shade(p.base, -0.45), 9);
  return {
    pattern: 'knit',
    parts: [
      sleeve,
      mirrorX(sleeve),
      cuff,
      mirrorX(cuff),
      'M 300 245 L 425 222 L 500 480 L 575 222 L 700 245 L 712 800 L 288 800 Z',
      'M 288 800 L 712 800 L 712 850 L 288 850 Z',
    ],
    details:
      shape('M 425 222 L 500 480 L 575 222 C 550 212, 450 212, 425 222 Z', p.inner, p.seam) +
      line('M 430 222 L 500 470 L 570 222', p.trim, 26) +
      line('M 500 470 L 500 850', p.trim, 26) +
      line('M 418 226 L 488 474 L 488 850', p.seam, 2) +
      line('M 582 226 L 512 474 L 512 850', p.seam, 2) +
      buttons +
      mirrored(cuff, p.trim, p.seam) +
      ribLines(158, 240, 690, 768, p.seam, 10) +
      ribLines(760, 842, 690, 768, p.seam, 10) +
      shape('M 288 800 L 487 800 L 487 850 L 288 850 Z', p.trim, p.seam) +
      shape('M 513 800 L 712 800 L 712 850 L 513 850 Z', p.trim, p.seam) +
      ribLines(288, 487, 800, 850, p.seam, 10) +
      ribLines(513, 712, 800, 850, p.seam, 10) +
      fold('M 360 520 Q 380 640 360 780', p.seam) +
      fold('M 640 520 Q 620 640 640 780', p.seam),
    floor: 850,
  };
}

function jeans(p: Palette): Garment {
  const gold = '#D4A34C';
  const denimStitch = (d: string) => line(d, gold, 2.5, 'stroke-dasharray="7 5" opacity="0.9"');
  let loops = '';
  for (const x of [352, 440, 560, 648]) {
    loops += `<rect x="${x - 7}" y="140" width="14" height="66" rx="3" fill="${shade(p.base, 0.06)}" stroke="${p.seam}" stroke-width="2"/>`;
  }
  return {
    parts: [
      'M 330 150 L 670 150 L 672 202 L 328 202 Z',
      'M 328 202 L 672 202 L 668 290 L 640 875 L 525 875 L 505 362 Q 500 350 495 362 L 475 875 L 360 875 L 332 290 Z',
    ],
    details:
      shape('M 330 150 L 670 150 L 672 202 L 328 202 Z', shade(p.base, 0.04), p.seam) +
      denimStitch('M 332 162 L 668 162') +
      denimStitch('M 331 192 L 669 192') +
      loops +
      `<circle cx="500" cy="176" r="10" fill="#B98B45" stroke="#8A6630" stroke-width="2"/>` +
      denimStitch('M 527 204 L 527 318 Q 527 346 502 354') +
      line('M 340 214 Q 395 232 418 204', p.seam, 3) +
      line('M 660 214 Q 605 232 582 204', p.seam, 3) +
      denimStitch('M 345 226 Q 395 244 425 212') +
      denimStitch('M 655 226 Q 605 244 575 212') +
      denimStitch('M 372 858 L 470 858') +
      denimStitch('M 530 858 L 628 858') +
      denimStitch('M 346 300 L 370 860') +
      denimStitch('M 654 300 L 630 860') +
      fold('M 380 640 Q 420 630 455 646', p.seam) +
      fold('M 545 646 Q 580 630 620 640', p.seam) +
      fold('M 470 380 Q 480 440 472 500', p.seam),
    floor: 875,
  };
}

function widePants(p: Palette): Garment {
  return {
    parts: [
      'M 345 150 L 655 150 L 657 200 L 343 200 Z',
      'M 343 200 L 657 200 L 700 460 L 745 880 L 520 880 L 500 380 L 480 880 L 255 880 L 300 460 Z',
    ],
    details:
      shape('M 345 150 L 655 150 L 657 200 L 343 200 Z', p.trim, p.seam) +
      button(500, 175, shade(p.base, -0.4), 8) +
      line('M 420 200 L 410 430', p.seam, 3) +
      line('M 580 200 L 590 430', p.seam, 3) +
      line('M 500 200 L 500 360', p.seam, 2) +
      line('M 352 212 Q 380 250 362 300', p.seam, 3) +
      line('M 648 212 Q 620 250 638 300', p.seam, 3) +
      stitchLine('M 262 862 L 476 862', p.stitch) +
      stitchLine('M 524 862 L 738 862', p.stitch) +
      fold('M 400 480 Q 380 700 360 870', p.seam) +
      fold('M 620 480 Q 640 700 660 870', p.seam) +
      fold('M 330 520 Q 310 700 290 860', p.seam) +
      fold('M 670 520 Q 690 700 710 860', p.seam),
    floor: 880,
  };
}

function skirt(p: Palette): Garment {
  const pleats = 14;
  let strips = '';
  for (let i = 0; i < pleats; i += 1) {
    const t0 = i / pleats;
    const t1 = (i + 1) / pleats;
    const top0 = 382 + 236 * t0;
    const top1 = 382 + 236 * t1;
    const bot0 = 240 + 520 * t0;
    const bot1 = 240 + 520 * t1;
    const hem = (t: number) => 830 + 28 * Math.sin(Math.PI * t);
    if (i % 2 === 1) {
      strips += `<path d="M ${top0} 245 L ${top1} 245 L ${bot1} ${hem(t1)} L ${bot0} ${hem(t0)} Z" fill="${shade(p.base, -0.09)}"/>`;
    }
    strips += line(`M ${top0} 245 L ${bot0} ${hem(t0)}`, p.seam, 1.5, 'opacity="0.55"');
  }
  return {
    parts: [
      'M 382 245 L 618 245 L 760 830 C 600 858, 400 858, 240 830 Z',
      'M 385 200 L 615 200 L 618 245 L 382 245 Z',
    ],
    details:
      strips +
      shape('M 385 200 L 615 200 L 618 245 L 382 245 Z', p.trim, p.seam) +
      stitchLine('M 388 212 L 612 212', p.stitch),
    floor: 858,
  };
}

function shirtDress(p: Palette): Garment {
  const sleeve = 'M 365 240 L 300 262 L 262 380 L 330 398 L 360 330 Z';
  const cuff = 'M 262 380 L 330 398 L 324 422 L 256 404 Z';
  let buttons = '';
  for (const y of [310, 380, 530, 600]) buttons += button(500, y, p.trim, 6);
  return {
    parts: [
      sleeve,
      mirrorX(sleeve),
      cuff,
      mirrorX(cuff),
      'M 365 240 L 440 212 L 500 262 L 560 212 L 635 240 L 628 470 L 700 870 C 600 890, 400 890, 300 870 L 372 470 Z',
    ],
    details:
      mirrored(cuff, p.trim, p.seam) +
      shape(
        'M 438 200 C 470 188, 530 188, 562 200 L 560 215 C 530 205, 470 205, 440 215 Z',
        p.inner,
        p.seam,
      ) +
      mirrored('M 440 205 L 500 262 L 470 300 L 420 250 Z', p.base, p.seam) +
      shape('M 488 262 L 512 262 L 512 640 L 488 640 Z', p.base, p.seam) +
      buttons +
      shape('M 368 452 L 632 452 L 634 490 L 366 490 Z', p.trim, p.seam) +
      shape('M 548 460 L 578 460 L 578 484 L 548 484 Z', shade(p.base, -0.12), p.seam) +
      shape('M 556 484 L 570 600 L 588 597 L 574 484 Z', p.trim, p.seam) +
      shape('M 572 484 L 610 590 L 626 582 L 588 482 Z', p.trim, p.seam) +
      stitchLine('M 304 858 C 400 876, 600 876, 696 858', p.stitch) +
      fold('M 420 520 Q 400 700 380 860', p.seam) +
      fold('M 580 520 Q 600 700 620 860', p.seam) +
      fold('M 500 660 Q 505 760 498 870', p.seam),
    floor: 890,
  };
}

function joggers(p: Palette): Garment {
  return {
    parts: [
      'M 340 170 L 660 170 L 662 225 L 338 225 Z',
      'M 338 225 L 662 225 L 680 420 L 640 800 L 535 800 L 505 392 Q 500 380 495 392 L 465 800 L 360 800 L 320 420 Z',
      'M 360 800 L 465 800 L 460 858 L 365 858 Z',
      'M 535 800 L 640 800 L 635 858 L 540 858 Z',
    ],
    details:
      shape('M 340 170 L 660 170 L 662 225 L 338 225 Z', p.trim, p.seam) +
      ribLines(340, 660, 170, 225, p.seam, 9) +
      shape('M 360 800 L 465 800 L 460 858 L 365 858 Z', p.trim, p.seam) +
      shape('M 535 800 L 640 800 L 635 858 L 540 858 Z', p.trim, p.seam) +
      ribLines(362, 463, 800, 858, p.seam, 9) +
      ribLines(537, 638, 800, 858, p.seam, 9) +
      line('M 490 225 Q 476 280 484 330', '#EDEBE6', 5) +
      line('M 510 225 Q 524 280 516 330', '#EDEBE6', 5) +
      '<circle cx="500" cy="226" r="7" fill="#E2E0DA"/>' +
      line('M 346 240 Q 386 300 356 362', p.seam, 3) +
      line('M 654 240 Q 614 300 644 362', p.seam, 3) +
      fold('M 380 560 Q 410 548 445 562', p.seam) +
      fold('M 555 562 Q 590 548 620 560', p.seam) +
      fold('M 390 700 Q 420 690 450 704', p.seam) +
      fold('M 550 704 Q 580 690 610 700', p.seam),
    floor: 858,
  };
}

function girlsDress(p: Palette): Garment {
  const strap = 'M 400 245 C 380 205, 390 175, 425 168 C 440 190, 450 215, 445 245 Z';
  const neck = 'M 400 245 C 450 275, 550 275, 600 245';
  const ribbon = shade(p.base, -0.28);
  let gathers = '';
  for (let x = 425; x <= 575; x += 25)
    gathers += line(`M ${x} 490 L ${x + (x - 500) * 0.2} 540`, p.seam, 2, 'opacity="0.5"');
  return {
    pattern: 'florals',
    parts: [
      strap,
      mirrorX(strap),
      `${neck} L 588 470 L 412 470 Z`,
      'M 412 470 L 588 470 C 650 600, 700 720, 740 850 C 600 885, 400 885, 260 850 C 300 720, 350 600, 412 470 Z',
    ],
    details:
      shape(`${neck} C 560 230, 440 230, 400 245 Z`, p.inner, p.seam) +
      line(neck, p.seam, 2) +
      gathers +
      shape('M 408 458 L 592 458 L 594 488 L 406 488 Z', ribbon, shade(ribbon, -0.2)) +
      shape(
        'M 500 473 C 470 436, 436 448, 450 482 C 460 502, 482 494, 500 473 Z',
        ribbon,
        shade(ribbon, -0.2),
      ) +
      shape(
        'M 500 473 C 530 436, 564 448, 550 482 C 540 502, 518 494, 500 473 Z',
        ribbon,
        shade(ribbon, -0.2),
      ) +
      shape('M 494 480 L 482 560 L 496 556 L 502 484 Z', ribbon, shade(ribbon, -0.2)) +
      shape('M 506 480 L 522 556 L 508 560 L 500 484 Z', ribbon, shade(ribbon, -0.2)) +
      `<circle cx="500" cy="473" r="11" fill="${ribbon}" stroke="${shade(ribbon, -0.2)}" stroke-width="2"/>` +
      stitchLine('M 266 836 C 400 868, 600 868, 734 836', p.stitch) +
      fold('M 440 560 Q 400 700 350 840', p.seam) +
      fold('M 560 560 Q 600 700 650 840', p.seam),
    floor: 885,
  };
}

function abaya(p: Palette): Garment {
  const sleeve =
    'M 385 200 L 290 240 C 230 360, 170 480, 120 590 L 290 640 C 310 520, 335 430, 360 360 Z';
  const sheen = shade(p.base, 0.22);
  return {
    parts: [
      sleeve,
      mirrorX(sleeve),
      'M 385 200 L 460 180 L 540 180 L 615 200 L 722 932 C 600 948, 400 948, 278 932 Z',
    ],
    details:
      shape(
        'M 455 178 C 470 214, 530 214, 545 178 C 530 170, 470 170, 455 178 Z',
        shade(p.base, -0.5),
        p.seam,
      ) +
      line('M 455 178 C 470 214, 530 214, 545 178', sheen, 5, 'stroke-dasharray="10 6"') +
      line('M 124 594 L 288 642', sheen, 7, 'stroke-dasharray="10 6"') +
      line('M 876 594 L 712 642', sheen, 7, 'stroke-dasharray="10 6"') +
      line('M 500 210 L 500 940', shade(p.base, 0.12), 3) +
      line('M 488 212 L 488 938', sheen, 4, 'stroke-dasharray="10 6"') +
      line('M 512 212 L 512 938', sheen, 4, 'stroke-dasharray="10 6"') +
      line('M 420 400 Q 400 650 370 925', sheen, 6, 'opacity="0.35"') +
      line('M 580 400 Q 600 650 630 925', sheen, 6, 'opacity="0.35"') +
      line('M 330 700 Q 320 800 310 925', sheen, 6, 'opacity="0.25"') +
      line('M 670 700 Q 680 800 690 925', sheen, 6, 'opacity="0.25"') +
      line('M 250 330 Q 230 420 200 520', sheen, 6, 'opacity="0.3"') +
      line('M 750 330 Q 770 420 800 520', sheen, 6, 'opacity="0.3"'),
    floor: 948,
  };
}

const GARMENTS: Record<string, typeof tshirt> = {
  tshirt,
  oversizedtee: oversizedTee,
  stripedtee: (p) => ({ ...tshirt(p), pattern: 'stripes' }),
  shirt,
  thobe,
  hoodie,
  bomber,
  cardigan,
  jeans,
  widepants: widePants,
  skirt,
  shirtdress: shirtDress,
  joggers,
  girlsdress: girlsDress,
  abaya,
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function patternLayer(pattern: Garment['pattern'], p: Palette, seed: number): string {
  if (pattern === 'stripes') {
    let out = '';
    for (let y = 250; y < 900; y += 64) {
      out += `<rect x="0" y="${y}" width="1000" height="28" fill="#FAF7F0" opacity="0.9"/>`;
    }
    return out;
  }
  if (pattern === 'knit') {
    let out = '';
    for (let x = 0; x < 1000; x += 11) {
      out += line(`M ${x} 0 L ${x} 1000`, shade(p.base, -0.12), 2, 'opacity="0.35"');
    }
    return out;
  }
  if (pattern === 'florals') {
    const random = seededRandom(seed);
    const petal = '#FFFFFF';
    const centre = '#F4C542';
    const leaf = shade(p.base, -0.35);
    let out = '';
    for (let i = 0; i < 70; i += 1) {
      const x = 240 + random() * 520;
      const y = 160 + random() * 720;
      const r = 7 + random() * 5;
      out += `<ellipse cx="${x + r * 1.6}" cy="${y + r * 0.8}" rx="${r * 0.9}" ry="${r * 0.45}" fill="${leaf}" opacity="0.7" transform="rotate(${Math.round(random() * 180)} ${x} ${y})"/>`;
      for (let k = 0; k < 5; k += 1) {
        const a = (k / 5) * Math.PI * 2;
        out += `<circle cx="${x + Math.cos(a) * r}" cy="${y + Math.sin(a) * r}" r="${r * 0.7}" fill="${petal}" opacity="0.92"/>`;
      }
      out += `<circle cx="${x}" cy="${y}" r="${r * 0.5}" fill="${centre}"/>`;
    }
    return out;
  }
  return '';
}

function garmentMarkup(garment: Garment, p: Palette, id: string, seed: number): string {
  const clip = garment.parts.map((d) => `<path d="${d}"/>`).join('');
  const body = garment.parts.map((d) => shape(d, p.base, p.seam)).join('');
  return `
<defs>
  <clipPath id="clip-${id}">${clip}</clipPath>
</defs>
<ellipse cx="500" cy="${garment.floor + 18}" rx="300" ry="26" fill="#000000" opacity="0.16" filter="url(#blur)"/>
${body}
<g clip-path="url(#clip-${id})">
  ${patternLayer(garment.pattern, p, seed)}
  <rect x="0" y="0" width="1000" height="1000" fill="url(#shadeH)"/>
  <rect x="0" y="0" width="1000" height="1000" fill="url(#shadeV)"/>
</g>
${garment.details}`;
}

function background(light: boolean): string {
  const [top, bottom] = light ? ['#DDD7CC', '#CFC8BB'] : ['#F3F0EA', '#E6E1D8'];
  return `
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${top}"/>
    <stop offset="1" stop-color="${bottom}"/>
  </linearGradient>
  <linearGradient id="shadeH" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0.2" stop-color="#000000" stop-opacity="0.14"/>
    <stop offset="0.42" stop-color="#000000" stop-opacity="0"/>
    <stop offset="0.58" stop-color="#000000" stop-opacity="0"/>
    <stop offset="0.8" stop-color="#000000" stop-opacity="0.14"/>
  </linearGradient>
  <linearGradient id="shadeV" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0.15" stop-color="#FFFFFF" stop-opacity="0.12"/>
    <stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0"/>
    <stop offset="0.95" stop-color="#000000" stop-opacity="0.1"/>
  </linearGradient>
  <filter id="blur" x="-20%" y="-200%" width="140%" height="500%">
    <feGaussianBlur stdDeviation="14"/>
  </filter>
</defs>`;
}

function productSvg(garmentKey: string, hex: string, seed: number): string {
  const draw = GARMENTS[garmentKey];
  if (!draw) throw new Error(`No drawing for garment "${garmentKey}"`);
  const p = palette(hex);
  const light = luminance(hex) > 0.72;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
${background(light)}
<rect width="1000" height="1000" fill="url(#bg)"/>
${garmentMarkup(draw(p), p, 'g', seed)}
</svg>`;
}

/** Three garments on a clothes rail, for the homepage hero. */
function heroSvg(): string {
  // [garment, colour, centre x, y offset, neck y on the 1000px canvas]
  const pieces: [string, string, number, number, number][] = [
    ['abaya', '#1D1D20', 270, 150, 178],
    ['girlsdress', '#F2A6B8', 780, 157, 168],
    ['thobe', '#F4F2EC', 520, 152, 176],
  ];
  const scale = 0.7;
  const rail = '#8E877B';
  let hangers = '';
  let groups = '';
  pieces.forEach(([key, hex, cx, y, neck], i) => {
    const p = palette(hex);
    const top = y + neck * scale;
    hangers +=
      line(
        `M ${cx} ${top - 30} C ${cx} ${top - 55}, ${cx + 22} ${top - 60}, ${cx + 20} ${top - 82} C ${cx + 18} ${top - 98}, ${cx - 2} ${top - 100}, ${cx - 8} ${top - 88}`,
        rail,
        5,
      ) + line(`M ${cx - 95} ${top + 6} L ${cx} ${top - 30} L ${cx + 95} ${top + 6} Z`, rail, 6);
    groups += `<g transform="translate(${cx - 500 * scale} ${y}) scale(${scale})">${garmentMarkup(GARMENTS[key]!(p), p, `h${i}`, 7 + i)}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
${background(false)}
<rect width="1000" height="1000" fill="url(#bg)"/>
${line('M 50 186 L 950 186', rail, 10)}
${hangers}
${groups}
</svg>`;
}

function colorSlug(color: DemoColor): string {
  return color.en.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function imageFileName(productSlug: string, color: DemoColor): string {
  return `${productSlug}-${colorSlug(color)}.webp`;
}

async function render(svg: string, file: string): Promise<void> {
  const webp = await sharp(Buffer.from(svg)).webp({ quality: 84 }).toBuffer();
  writeFileSync(path.join(outDir, file), webp);
  console.log(`  ${file} (${Math.round(webp.byteLength / 1024)} KB)`);
}

mkdirSync(outDir, { recursive: true });
let seed = 1;
for (const product of catalog.products) {
  for (const color of product.colors) {
    await render(productSvg(product.garment, color.hex, seed), imageFileName(product.slug, color));
    seed += 1;
  }
}
await render(heroSvg(), 'hero.webp');
console.log(`\nWrote images to ${path.relative(process.cwd(), outDir)}`);
