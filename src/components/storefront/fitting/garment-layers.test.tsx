import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AvatarRenderInput } from '@/lib/avatar/avatar-model';
import { NEUTRAL_APPEARANCE } from '@/lib/avatar/avatar-model';
import type { SizingProfile } from '@/modules/body-profile';
import { virtualFittingService, type FittingResult } from '@/modules/fitting';
import {
  GARMENT_TYPES,
  resolveGarmentStyle,
  type GarmentType,
  type SizeChartRow,
} from '@/modules/sizing';
import { LocalAvatarRenderer } from '@/components/storefront/avatar/local-avatar-renderer';

import { garmentLayers } from './garment-layers';

/**
 * The garment on the avatar, rendered to markup: every garment type draws,
 * in its colour and pattern, sized by the chosen size, taking the right
 * slots over — and the same fitting always draws the same picture.
 */

const swatch = (digits: string) => `#${digits}`;

const PROFILE: SizingProfile = {
  gender: 'MALE',
  heightCm: 177,
  waistCm: 84,
  weightKg: 78,
  bodyShape: null,
  fitPreference: 'REGULAR',
  optional: {
    chestCm: 97,
    hipCm: 98,
    shoulderCm: 45,
    inseamCm: 81,
    sleeveLengthCm: 62,
    neckCm: null,
  },
};
const AVATAR: AvatarRenderInput = {
  measurements: {
    heightCm: 177,
    weightKg: 78,
    waistCm: 84,
    chestCm: 97,
    hipCm: 98,
    shoulderCm: 45,
    inseamCm: 81,
    sleeveLengthCm: 62,
  },
  appearance: NEUTRAL_APPEARANCE,
};

function chartFor(garment: GarmentType): SizeChartRow[] {
  return [0, 1, 2].map((i) => ({
    sizeId: `s${i}`,
    label: { ar: `S${i}`, en: `S${i}` },
    measurements: {
      chestCm: 100 + i * 6,
      waistCm: 82 + i * 5,
      hipCm: 98 + i * 5,
      shoulderCm: 43 + i * 2,
      sleeveCm: 60 + i,
      inseamCm: 80 + i,
      lengthCm: garment === 'THOBE' || garment === 'ABAYA' ? 137 + i * 5 : 70 + i * 2,
    },
  }));
}

function fitting(
  garment: GarmentType,
  sizeId = 's1',
  extra: { hex?: string | null; pattern?: 'STRIPED' | 'FLORAL' } = {},
): FittingResult {
  return virtualFittingService.fit({
    profile: PROFILE,
    product: {
      productId: 'p',
      garmentType: garment,
      style: resolveGarmentStyle(garment, { pattern: extra.pattern ?? null }),
      chart: chartFor(garment),
    },
    sizeId,
    color:
      extra.hex === null
        ? null
        : {
            valueId: 'c',
            label: { ar: 'لون', en: 'Colour' },
            swatchHex: extra.hex ?? swatch('2F3F66'),
          },
  });
}

function draw(result: FittingResult): string {
  return renderToStaticMarkup(
    <LocalAvatarRenderer
      input={AVATAR}
      layers={garmentLayers(result)}
      title="t"
      description="d"
      heightLabel="177 cm"
      direction="ltr"
    />,
  );
}

const layersOf = (markup: string) => markup.match(/data-layers="([^"]*)"/)![1]!.split(' ');

describe('garmentLayers', () => {
  it.each(GARMENT_TYPES)('%s draws on the avatar, in its colour', (garment) => {
    const markup = draw(fitting(garment));
    expect(markup).toContain(`data-garment="${garment}"`);
    expect(markup).toContain(swatch('2F3F66'));
    expect(markup).not.toMatch(/NaN|Infinity/);
  });

  it('a top takes the top slot and keeps the base bottom; a bottom the reverse', () => {
    const tee = layersOf(draw(fitting('T_SHIRT')));
    expect(tee).toContain('garment:T_SHIRT:s1');
    expect(tee).not.toContain('base:top');
    expect(tee).toContain('base:bottom');

    const jeans = layersOf(draw(fitting('JEANS')));
    expect(jeans).toContain('garment:JEANS:s1');
    expect(jeans).not.toContain('base:bottom');
    expect(jeans).toContain('base:top');
  });

  it('a full-length garment replaces both top and bottom', () => {
    const thobe = layersOf(draw(fitting('THOBE')));
    expect(thobe).toContain('garment:THOBE:s1');
    expect(thobe).not.toContain('base:top');
    expect(thobe).not.toContain('base:bottom');
  });

  it('outerwear goes over the base top; a hoodie brings its hood behind the head', () => {
    const jacket = layersOf(draw(fitting('JACKET')));
    expect(jacket).toContain('base:top');
    expect(jacket.indexOf('garment:JACKET:s1')).toBeGreaterThan(jacket.indexOf('base:top'));
    const hoodie = draw(fitting('HOODIE'));
    expect(hoodie).toContain('data-part="hood"');
    expect(layersOf(hoodie).indexOf('garment:HOODIE:s1:hood')).toBeLessThan(
      layersOf(hoodie).indexOf('base:body'),
    );
  });

  it('the chosen size changes the drawing; the same fitting draws the same picture', () => {
    const small = draw(fitting('T_SHIRT', 's0'));
    const large = draw(fitting('T_SHIRT', 's2'));
    expect(small).not.toBe(large);
    expect(draw(fitting('T_SHIRT', 's1'))).toBe(draw(fitting('T_SHIRT', 's1')));
  });

  it('a size short of room shows strain, in lines and not colour alone', () => {
    const tight = virtualFittingService.fit({
      profile: { ...PROFILE, optional: { ...PROFILE.optional, chestCm: 110 } },
      product: {
        productId: 'p',
        garmentType: 'T_SHIRT',
        style: resolveGarmentStyle('T_SHIRT'),
        chart: chartFor('T_SHIRT'),
      },
      sizeId: 's1',
      color: null,
    });
    expect(tight.fit?.areas).toContainEqual({ measurement: 'chestCm', fit: 'too_tight' });
    expect(draw(tight)).toContain('data-part="strain"');
    expect(draw(fitting('T_SHIRT', 's2'))).not.toContain('data-part="strain"');
  });

  it('a pattern is drawn with a pattern fill; no colour falls back to a token', () => {
    const striped = draw(fitting('T_SHIRT', 's1', { pattern: 'STRIPED' }));
    expect(striped).toContain('<pattern');
    expect(striped).toMatch(/fill="url\(#[^)]*garment-pattern\)"/);
    const neutral = draw(fitting('T_SHIRT', 's1', { hex: null }));
    expect(neutral).toContain('var(--avatar-garment-top)');
    expect(neutral).not.toContain('<pattern');
  });
});
