import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AvatarLayer } from '@/components/storefront/avatar/avatar-layers';
import { NEUTRAL_APPEARANCE, type AvatarRenderInput } from '@/lib/avatar/avatar-model';

import {
  AVATAR_RENDERERS,
  AvatarPreview,
  DEFAULT_AVATAR_RENDERER,
  resolveAvatarRenderer,
} from './avatar-renderer';

/**
 * The avatar renderers, rendered to markup the way the server renders
 * them: deterministic output, what measurements and appearance change,
 * switching renderers, garment layers, invalid input and accessibility.
 */

const PROFILE: AvatarRenderInput = {
  measurements: {
    heightCm: 177,
    weightKg: 78,
    waistCm: 84,
    chestCm: 100,
    hipCm: 98,
    shoulderCm: 46,
  },
  appearance: {
    skinTone: 'MEDIUM',
    hairStyle: 'SHORT',
    hairColor: 'BLACK',
    facialHair: 'SHORT_BEARD',
    wearsGlasses: true,
    glassesStyle: 'ROUND',
    glassesFrameColor: 'GOLD',
  },
  bodyShape: 'STRAIGHT',
};

function render(
  input: AvatarRenderInput,
  extra: { kind?: 'local' | 'basic'; layers?: AvatarLayer[]; direction?: 'rtl' | 'ltr' } = {},
): string {
  return renderToStaticMarkup(
    <AvatarPreview
      kind={extra.kind}
      input={input}
      title="Your illustration"
      description="Height: 177 cm, medium skin tone"
      heightLabel="177 cm"
      direction={extra.direction ?? 'ltr'}
      layers={extra.layers}
    />,
  );
}

const attr = (markup: string, name: string) => markup.match(new RegExp(`${name}="([^"]*)"`))?.[1];

describe('LocalAvatarRenderer', () => {
  it('is the default, and deterministic: the same profile draws the same markup', () => {
    const a = render(PROFILE);
    expect(attr(a, 'data-renderer')).toBe('local');
    expect(render(PROFILE)).toBe(a);
    expect(render(structuredClone(PROFILE))).toBe(a);
  });

  it('draws its layers in order: body, base outfit, head, face, hair, glasses', () => {
    expect(attr(render(PROFILE), 'data-layers')).toBe(
      [
        'base:shadow',
        'base:hairBack',
        'base:body',
        'base:bottom',
        'base:shoes',
        'base:top',
        'base:head',
        'base:face',
        'base:facialHair',
        'base:hair',
        'base:covering',
        'base:glasses',
      ].join(' '),
    );
  });

  it('a measurement change changes the figure; an unrelated one does not', () => {
    const base = render(PROFILE);
    const widerWaist = render({
      ...PROFILE,
      measurements: { ...PROFILE.measurements, waistCm: 104 },
    });
    const taller = render({ ...PROFILE, measurements: { ...PROFILE.measurements, heightCm: 190 } });
    expect(widerWaist).not.toBe(base);
    expect(taller).not.toBe(base);
    expect(attr(taller, 'data-height-cm')).toBe('190');
  });

  it('appearance choices draw what was chosen, and nothing that was not', () => {
    const markup = render(PROFILE);
    expect(markup).toContain('data-part="hair"');
    expect(markup).toContain('data-part="facial-hair"');
    expect(markup).toContain('data-part="glasses"');
    expect(markup).toContain('var(--avatar-skin-medium)');
    expect(markup).toContain('var(--avatar-frame-gold)');

    const neutral = render({ measurements: {}, appearance: NEUTRAL_APPEARANCE });
    expect(neutral).not.toContain('data-part="hair"');
    expect(neutral).not.toContain('data-part="facial-hair"');
    expect(neutral).not.toContain('data-part="glasses"');
    expect(neutral).toContain('var(--avatar-skin-unset)');
    expect(attr(neutral, 'data-glasses')).toBe('none');
  });

  it('a head covering replaces the hair, and leaves the face open', () => {
    const covered = render({
      ...PROFILE,
      appearance: { ...PROFILE.appearance, hairStyle: 'COVERED' },
    });
    expect(covered).toContain('data-part="covering"');
    expect(covered).not.toContain('data-part="hair"');
    expect(covered).toContain('fill-rule="evenodd"');
  });

  it('every hair style draws something distinct', () => {
    const styles = ['SHORT', 'MEDIUM', 'LONG', 'STRAIGHT', 'WAVY', 'CURLY', 'BUZZ'] as const;
    const drawn = styles.map((hairStyle) =>
      render({ ...PROFILE, appearance: { ...PROFILE.appearance, hairStyle } }),
    );
    expect(new Set(drawn).size).toBe(styles.length);
  });

  it('a garment layer takes its slot, and a full-length one covers the bottom too', () => {
    const thobe: AvatarLayer = {
      id: 'garment:thobe',
      slot: 'top',
      replaces: ['bottom'],
      render: () => <path data-part="garment" d="M 0 0 Z" />,
    };
    const markup = render(PROFILE, { layers: [thobe] });
    expect(attr(markup, 'data-layers')).toContain('garment:thobe');
    expect(attr(markup, 'data-layers')).not.toContain('base:top');
    expect(attr(markup, 'data-layers')).not.toContain('base:bottom');
    expect(markup).toContain('data-part="garment"');
  });

  it('invalid measurements draw the neutral figure, not a broken one', () => {
    const broken = render({
      measurements: {
        heightCm: -1,
        waistCm: Number.NaN,
        chestCm: 10_000,
      } as AvatarRenderInput['measurements'],
      appearance: NEUTRAL_APPEARANCE,
    });
    const neutral = render({ measurements: {}, appearance: NEUTRAL_APPEARANCE });
    expect(broken).toBe(neutral);
    expect(broken).not.toMatch(/NaN|Infinity/);
  });

  it('is an accessible image: named, described, the height label anchored for the language', () => {
    const ltr = render(PROFILE);
    expect(attr(ltr, 'role')).toBe('img');
    const titleId = attr(ltr, 'aria-labelledby');
    const descId = attr(ltr, 'aria-describedby');
    expect(ltr).toContain(`<title id="${titleId}">Your illustration</title>`);
    expect(ltr).toContain(`<desc id="${descId}">Height: 177 cm, medium skin tone</desc>`);
    expect(ltr).toMatch(/text-anchor="end"[^>]*data-testid="avatar-height-label"/);
    expect(render(PROFILE, { direction: 'rtl' })).toMatch(
      /text-anchor="start"[^>]*data-testid="avatar-height-label"/,
    );
    // One title in the whole image — no stray nested names.
    expect(ltr.match(/<title/g)).toHaveLength(1);
  });

  it('eases shapes only through the design system’s motion class', () => {
    expect(attr(render(PROFILE), 'class')).toContain('avatar-motion');
  });
});

describe('switching renderers', () => {
  it('the kind picks the renderer; both draw the same profile', () => {
    expect(attr(render(PROFILE, { kind: 'basic' }), 'data-renderer')).toBe('basic');
    expect(attr(render(PROFILE, { kind: 'local' }), 'data-renderer')).toBe('local');
    expect(attr(render(PROFILE, { kind: 'basic' }), 'data-height-cm')).toBe('177');
  });

  it('an unknown kind falls back to the default instead of drawing nothing', () => {
    expect(resolveAvatarRenderer('three-d')).toBe(AVATAR_RENDERERS[DEFAULT_AVATAR_RENDERER]);
    expect(resolveAvatarRenderer(undefined)).toBe(AVATAR_RENDERERS.local);
  });

  it('the basic renderer ignores garment layers rather than failing', () => {
    const garment: AvatarLayer = { id: 'garment:x', slot: 'top', render: () => <circle /> };
    expect(render(PROFILE, { kind: 'basic', layers: [garment] })).toBe(
      render(PROFILE, { kind: 'basic' }),
    );
  });
});
