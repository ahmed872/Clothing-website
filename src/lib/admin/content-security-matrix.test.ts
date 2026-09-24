import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@generated/prisma';

import { db } from '@/modules/core';
import { resetIdentityTables } from '@/modules/identity/testing';
import { resetContentTables } from '@/modules/content/testing';
import { createUser } from '@/modules/identity/user.service';

/**
 * Homepage content's authorization matrix (P15), exercised against the
 * server actions themselves — never through the UI. The Content link being
 * absent from a STAFF sidebar proves nothing; these prove the server
 * refuses when the URL is typed and the action is called anyway.
 *
 * `content.manage` is a MANAGER-and-above permission: running the store's
 * shop window is store management, not a daily operations task, so STAFF —
 * who may count stock and move orders along — cannot rewrite the homepage.
 * The list below is written out literally rather than derived from
 * `ROLE_PERMISSIONS` so that changing who may publish the storefront has to
 * be a deliberate edit in two places.
 */

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  // `updateTag` is what the admin actions call for read-your-own-writes
  // cache invalidation; a mock missing it fails as "not a function".
  updateTag: vi.fn(),
}));

const authMock = vi.fn();
vi.mock('@/modules/identity/auth', () => ({ auth: authMock }));

const {
  createHomepageSectionAction,
  updateHomepageSectionAction,
  publishHomepageSectionDraftAction,
  discardHomepageSectionDraftAction,
  setHomepageSectionEnabledAction,
  deleteHomepageSectionAction,
  reorderHomepageSectionsAction,
  searchProductsForContentAction,
  listCategoriesForContentAction,
  resolveProductLabelsAction,
} = await import('./content-actions');

const { createHomepageSection, listHomepageSections, getHomepageSection } =
  await import('@/modules/content');

const ACTOR_ID = '00000000-0000-4000-8000-0000000000cc';

const HERO_CONFIG = { titleAr: 'مرحبا', titleEn: 'Welcome' };

function signInAs(role: Role | null): void {
  authMock.mockResolvedValue(
    role
      ? {
          user: { id: ACTOR_ID, email: `${role.toLowerCase()}@example.com`, name: null, role },
          expires: '2099-01-01T00:00:00.000Z',
        }
      : null,
  );
}

async function seedActor(role: Role): Promise<void> {
  const user = await createUser({
    email: `content-actor-${role.toLowerCase()}@example.com`,
    password: 'matrix-pass-123',
    role,
  });
  await db.user.update({ where: { id: user.id }, data: { id: ACTOR_ID } });
}

async function seedSection() {
  return createHomepageSection({ type: 'HERO', config: HERO_CONFIG });
}

beforeEach(async () => {
  await resetContentTables();
  await resetIdentityTables();
  authMock.mockReset();
});

describe('permission matrix', () => {
  const ROLES: Role[] = ['OWNER', 'MANAGER', 'STAFF', 'CUSTOMER'];
  const ALLOWED: Role[] = ['OWNER', 'MANAGER'];

  for (const role of ROLES) {
    const expected = ALLOWED.includes(role);
    const verb = expected ? 'allowed' : 'refused';

    it(`createHomepageSectionAction: ${role} is ${verb}`, async () => {
      await seedActor(role);
      signInAs(role);
      const result = await createHomepageSectionAction(
        { type: 'HERO', config: HERO_CONFIG, enabled: true },
        'en',
      );
      expect(result.ok).toBe(expected);
      expect(await db.homepageSection.count()).toBe(expected ? 1 : 0);
    });

    it(`updateHomepageSectionAction: ${role} is ${verb}`, async () => {
      await seedActor(role);
      const section = await seedSection();
      signInAs(role);
      const result = await updateHomepageSectionAction(
        section.id,
        { ...HERO_CONFIG, titleEn: 'Rewritten' },
        'publish',
        'en',
      );
      expect(result.ok).toBe(expected);
      const after = await getHomepageSection(section.id);
      expect((after?.config as { titleEn: string }).titleEn).toBe(
        expected ? 'Rewritten' : 'Welcome',
      );
    });

    it(`publishHomepageSectionDraftAction: ${role} is ${verb}`, async () => {
      await seedActor(role);
      const section = await seedSection();
      await db.homepageSection.update({
        where: { id: section.id },
        data: { draftConfig: { ...HERO_CONFIG, titleEn: 'From draft' } },
      });
      signInAs(role);
      expect((await publishHomepageSectionDraftAction(section.id, 'en')).ok).toBe(expected);
    });

    it(`discardHomepageSectionDraftAction: ${role} is ${verb}`, async () => {
      await seedActor(role);
      const section = await seedSection();
      await db.homepageSection.update({
        where: { id: section.id },
        data: { draftConfig: HERO_CONFIG },
      });
      signInAs(role);
      expect((await discardHomepageSectionDraftAction(section.id, 'en')).ok).toBe(expected);
    });

    it(`setHomepageSectionEnabledAction: ${role} is ${verb}`, async () => {
      await seedActor(role);
      const section = await seedSection();
      signInAs(role);
      const result = await setHomepageSectionEnabledAction(section.id, false, 'en');
      expect(result.ok).toBe(expected);
      expect((await getHomepageSection(section.id))?.enabled).toBe(!expected);
    });

    it(`deleteHomepageSectionAction: ${role} is ${verb}`, async () => {
      await seedActor(role);
      const section = await seedSection();
      signInAs(role);
      const result = await deleteHomepageSectionAction(section.id, 'en');
      expect(result.ok).toBe(expected);
      expect(await db.homepageSection.count()).toBe(expected ? 0 : 1);
    });

    it(`reorderHomepageSectionsAction: ${role} is ${verb}`, async () => {
      await seedActor(role);
      const first = await seedSection();
      const second = await seedSection();
      signInAs(role);
      const result = await reorderHomepageSectionsAction([second.id, first.id], 'en');
      expect(result.ok).toBe(expected);
      expect((await listHomepageSections()).map((s) => s.id)).toEqual(
        expected ? [second.id, first.id] : [first.id, second.id],
      );
    });

    // The pickers read the catalog. They throw rather than returning an
    // `ActionResult`, because a refused *read* has no inline message to
    // show — the screen it feeds was never reachable in the first place.
    it(`searchProductsForContentAction: ${role} is ${verb}`, async () => {
      await seedActor(role);
      signInAs(role);
      const call = searchProductsForContentAction('anything', 'en');
      if (expected) await expect(call).resolves.toBeInstanceOf(Array);
      else await expect(call).rejects.toThrow();
    });

    it(`listCategoriesForContentAction: ${role} is ${verb}`, async () => {
      await seedActor(role);
      signInAs(role);
      const call = listCategoriesForContentAction('en');
      if (expected) await expect(call).resolves.toBeInstanceOf(Array);
      else await expect(call).rejects.toThrow();
    });

    it(`resolveProductLabelsAction: ${role} is ${verb}`, async () => {
      await seedActor(role);
      signInAs(role);
      const call = resolveProductLabelsAction([], 'en');
      if (expected) await expect(call).resolves.toEqual([]);
      else await expect(call).rejects.toThrow();
    });
  }

  it('a signed-out caller is refused every write, and the sections are untouched', async () => {
    const section = await seedSection();
    signInAs(null);

    expect(
      (
        await createHomepageSectionAction(
          { type: 'HERO', config: HERO_CONFIG, enabled: true },
          'en',
        )
      ).ok,
    ).toBe(false);
    expect((await updateHomepageSectionAction(section.id, HERO_CONFIG, 'publish', 'en')).ok).toBe(
      false,
    );
    expect((await setHomepageSectionEnabledAction(section.id, false, 'en')).ok).toBe(false);
    expect((await deleteHomepageSectionAction(section.id, 'en')).ok).toBe(false);
    expect((await reorderHomepageSectionsAction([section.id], 'en')).ok).toBe(false);

    expect(await db.homepageSection.count()).toBe(1);
    expect((await getHomepageSection(section.id))?.enabled).toBe(true);
  });
});

describe('what an authorized caller still cannot do', () => {
  beforeEach(async () => {
    await seedActor('OWNER');
    signInAs('OWNER');
  });

  it('cannot store a config that does not match its section type', async () => {
    const result = await createHomepageSectionAction(
      { type: 'HERO', config: { titleAr: 'بلا عنوان إنجليزي' }, enabled: true },
      'en',
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(await db.homepageSection.count()).toBe(0);
  });

  it('cannot reorder with a list that does not name every section', async () => {
    const first = await seedSection();
    await seedSection();

    const result = await reorderHomepageSectionsAction([first.id], 'en');
    expect(result.ok).toBe(false);
    expect((await listHomepageSections())[0]!.id).toBe(first.id);
  });

  it('cannot publish a section that has no draft', async () => {
    const section = await seedSection();
    expect((await publishHomepageSectionDraftAction(section.id, 'en')).ok).toBe(false);
  });

  it('cannot act on a section id that does not exist', async () => {
    const missing = '11111111-1111-4111-8111-111111111111';
    expect((await deleteHomepageSectionAction(missing, 'en')).ok).toBe(false);
    expect((await setHomepageSectionEnabledAction(missing, false, 'en')).ok).toBe(false);
    expect((await updateHomepageSectionAction(missing, HERO_CONFIG, 'publish', 'en')).ok).toBe(
      false,
    );
  });
});

describe('the audit trail', () => {
  beforeEach(async () => {
    await seedActor('OWNER');
    signInAs('OWNER');
  });

  it('records who created, published, disabled and deleted a section', async () => {
    const created = await createHomepageSectionAction(
      { type: 'HERO', config: HERO_CONFIG, enabled: true },
      'en',
    );
    const id = created.data!.id;

    await updateHomepageSectionAction(id, { ...HERO_CONFIG, titleEn: 'Edited' }, 'draft', 'en');
    await publishHomepageSectionDraftAction(id, 'en');
    await setHomepageSectionEnabledAction(id, false, 'en');
    await deleteHomepageSectionAction(id, 'en');

    const entries = await db.auditLog.findMany({
      where: { entityType: 'HomepageSection' },
      orderBy: { createdAt: 'asc' },
    });

    expect(entries.map((entry) => entry.action)).toEqual([
      'content.section_created',
      'content.section_updated',
      'content.section_published',
      'content.section_disabled',
      'content.section_deleted',
    ]);
    expect(entries.every((entry) => entry.userId === ACTOR_ID)).toBe(true);
  });

  it('records a reorder without pretending one section was the subject', async () => {
    const first = await seedSection();
    const second = await seedSection();

    await reorderHomepageSectionsAction([second.id, first.id], 'en');

    const entry = await db.auditLog.findFirstOrThrow({
      where: { action: 'content.sections_reordered' },
    });
    // No section is *the* subject of a reorder, so the entry names the
    // resulting order. `recordAuditEvent` then falls back to the acting
    // admin for `entityId`, which is the useful answer for this one.
    expect(entry.entityId).toBe(ACTOR_ID);
    expect(entry.after).toMatchObject({ order: ['0:HERO', '1:HERO'] });
  });

  it('writes nothing to the log when the action was refused', async () => {
    signInAs('STAFF');
    await createHomepageSectionAction({ type: 'HERO', config: HERO_CONFIG, enabled: true }, 'en');
    expect(await db.auditLog.count({ where: { entityType: 'HomepageSection' } })).toBe(0);
  });
});
