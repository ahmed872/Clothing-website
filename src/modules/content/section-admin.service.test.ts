import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';
import { isAppError } from '@/modules/core';

import { getPublishedHomepageSections } from './homepage.service';
import {
  createHomepageSection,
  deleteHomepageSection,
  discardHomepageSectionDraft,
  getHomepageSection,
  getSectionHeadline,
  listHomepageSections,
  publishHomepageSectionDraft,
  reorderHomepageSections,
  setHomepageSectionEnabled,
  updateHomepageSectionConfig,
} from './section-admin.service';
import { resetContentTables } from './testing';

/**
 * The admin write side (P15). The claims worth testing here are the ones
 * that decide what a visitor sees: that a draft never reaches the
 * storefront, that publishing is the only thing that moves it there, and
 * that a reorder is all-or-nothing.
 */

beforeEach(async () => {
  await resetContentTables();
});

const HERO = { titleAr: 'مرحبا', titleEn: 'Welcome' };

async function seedHero(overrides: Record<string, unknown> = {}) {
  return createHomepageSection({ type: 'HERO', config: { ...HERO, ...overrides } });
}

describe('createHomepageSection', () => {
  it('appends each new section after the last one', async () => {
    const first = await seedHero({ titleEn: 'First' });
    const second = await seedHero({ titleEn: 'Second' });
    const third = await seedHero({ titleEn: 'Third' });

    expect([first.position, second.position, third.position]).toEqual([0, 1, 2]);
    expect((await listHomepageSections()).map((s) => s.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
  });

  it('refuses a config its own type rejects, before anything is written', async () => {
    await expect(
      createHomepageSection({ type: 'HERO', config: { titleAr: 'بدون إنجليزي' } }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isAppError(error) && error.details?.reasonCode === 'section_config_invalid',
    );
    expect(await db.homepageSection.count()).toBe(0);
  });

  it('refuses a config that belongs to a different section type', async () => {
    // A valid FEATURED_PRODUCTS config, handed to a HERO.
    await expect(
      createHomepageSection({
        type: 'HERO',
        config: { productIds: ['11111111-1111-4111-8111-111111111111'] },
      }),
    ).rejects.toThrow();
  });

  it('creates enabled by default, and disabled when asked', async () => {
    expect((await seedHero()).enabled).toBe(true);
    const hidden = await createHomepageSection({ type: 'HERO', config: HERO, enabled: false });
    expect(hidden.enabled).toBe(false);
  });
});

describe('draft and publish', () => {
  it('a draft edit never reaches the storefront', async () => {
    const section = await seedHero({ titleEn: 'Published copy' });
    await updateHomepageSectionConfig(
      section.id,
      { titleAr: 'مسودة', titleEn: 'Draft copy' },
      'draft',
    );

    const live = await getPublishedHomepageSections('en');
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ titleEn: 'Published copy' });

    const stored = await getHomepageSection(section.id);
    expect(stored?.draftConfig).toMatchObject({ titleEn: 'Draft copy' });
  });

  it('publishing the draft moves it to config and clears the draft', async () => {
    const section = await seedHero({ titleEn: 'Published copy' });
    await updateHomepageSectionConfig(
      section.id,
      { titleAr: 'مسودة', titleEn: 'Draft copy' },
      'draft',
    );

    const published = await publishHomepageSectionDraft(section.id);
    expect(published.config).toMatchObject({ titleEn: 'Draft copy' });
    expect(published.draftConfig).toBeNull();

    const live = await getPublishedHomepageSections('en');
    expect(live[0]).toMatchObject({ titleEn: 'Draft copy' });
  });

  it('saving in publish mode clears a stale draft rather than leaving it behind', async () => {
    const section = await seedHero();
    await updateHomepageSectionConfig(section.id, { ...HERO, titleEn: 'Older draft' }, 'draft');

    const saved = await updateHomepageSectionConfig(
      section.id,
      { ...HERO, titleEn: 'Direct publish' },
      'publish',
    );

    expect(saved.config).toMatchObject({ titleEn: 'Direct publish' });
    expect(saved.draftConfig).toBeNull();
  });

  it('refuses to publish when there is no draft, rather than reporting a no-op as success', async () => {
    const section = await seedHero();
    await expect(publishHomepageSectionDraft(section.id)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.details?.reasonCode === 'section_has_no_draft',
    );
  });

  it('discarding a draft leaves the published config untouched', async () => {
    const section = await seedHero({ titleEn: 'Published copy' });
    await updateHomepageSectionConfig(section.id, { ...HERO, titleEn: 'Draft copy' }, 'draft');

    const discarded = await discardHomepageSectionDraft(section.id);
    expect(discarded.draftConfig).toBeNull();
    expect(discarded.config).toMatchObject({ titleEn: 'Published copy' });
  });

  it('validates a draft too — an unrenderable shape is never stored', async () => {
    const section = await seedHero();
    await expect(
      updateHomepageSectionConfig(section.id, { titleAr: '' }, 'draft'),
    ).rejects.toThrow();
    expect((await getHomepageSection(section.id))?.draftConfig).toBeNull();
  });
});

describe('enabled', () => {
  it('a disabled section keeps its config and disappears from the storefront', async () => {
    const section = await seedHero({ titleEn: 'Seasonal' });
    await setHomepageSectionEnabled(section.id, false);

    expect(await getPublishedHomepageSections('en')).toEqual([]);
    expect((await getHomepageSection(section.id))?.config).toMatchObject({ titleEn: 'Seasonal' });

    await setHomepageSectionEnabled(section.id, true);
    expect(await getPublishedHomepageSections('en')).toHaveLength(1);
  });
});

describe('reorderHomepageSections', () => {
  it('rewrites positions from the given order', async () => {
    const a = await seedHero({ titleEn: 'A' });
    const b = await seedHero({ titleEn: 'B' });
    const c = await seedHero({ titleEn: 'C' });

    const reordered = await reorderHomepageSections([c.id, a.id, b.id]);
    expect(reordered.map((s) => s.id)).toEqual([c.id, a.id, b.id]);
    expect(reordered.map((s) => s.position)).toEqual([0, 1, 2]);

    // The storefront reads the same order.
    const live = await getPublishedHomepageSections('en');
    expect(live.map((s) => (s as { titleEn: string }).titleEn)).toEqual(['C', 'A', 'B']);
  });

  it('refuses a partial list and writes nothing', async () => {
    const a = await seedHero({ titleEn: 'A' });
    const b = await seedHero({ titleEn: 'B' });

    await expect(reorderHomepageSections([b.id])).rejects.toSatisfy(
      (error: unknown) =>
        isAppError(error) && error.details?.reasonCode === 'section_order_mismatch',
    );
    expect((await listHomepageSections()).map((s) => s.id)).toEqual([a.id, b.id]);
  });

  it('refuses a list naming the same section twice', async () => {
    const a = await seedHero({ titleEn: 'A' });
    await seedHero({ titleEn: 'B' });

    await expect(reorderHomepageSections([a.id, a.id])).rejects.toThrow();
  });

  it('refuses an id that is not a section at all', async () => {
    await seedHero();
    await expect(
      reorderHomepageSections(['11111111-1111-4111-8111-111111111111']),
    ).rejects.toThrow();
  });
});

describe('deleteHomepageSection', () => {
  it('removes the row and returns what was deleted', async () => {
    const section = await seedHero({ titleEn: 'Going away' });
    const deleted = await deleteHomepageSection(section.id);

    expect(deleted.config).toMatchObject({ titleEn: 'Going away' });
    expect(await getHomepageSection(section.id)).toBeNull();
    expect(await getPublishedHomepageSections('en')).toEqual([]);
  });

  it('a missing section is NOT_FOUND, not a silent success', async () => {
    await expect(deleteHomepageSection('11111111-1111-4111-8111-111111111111')).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === 'NOT_FOUND',
    );
  });
});

describe('getSectionHeadline', () => {
  it('reads both titles when they are set', () => {
    expect(getSectionHeadline({ titleAr: 'عنوان', titleEn: 'Title' })).toEqual({
      ar: 'عنوان',
      en: 'Title',
    });
  });

  it('treats an absent, blank or non-string title as no title', () => {
    expect(getSectionHeadline({ titleAr: '   ', titleEn: 42 })).toEqual({ ar: null, en: null });
    expect(getSectionHeadline({})).toEqual({ ar: null, en: null });
    expect(getSectionHeadline(null)).toEqual({ ar: null, en: null });
  });
});
