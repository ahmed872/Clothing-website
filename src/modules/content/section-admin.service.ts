import { AppError, db } from '@/modules/core';
import { Prisma, type HomepageSection, type HomepageSectionType } from '@generated/prisma';

import { sectionConfigSchemas } from './section-schemas';

/**
 * The admin write side of the homepage (P15).
 *
 * `homepage.service.ts` is the storefront's read path and stays exactly as
 * it was: it reads `config` only, never `draftConfig`. This file is the
 * other half — the one place a section is created, edited, reordered,
 * enabled or published from, so the two states stay meaningful:
 *
 *   - **`config`** is what the public homepage renders. Writing it is
 *     publishing.
 *   - **`draftConfig`** is an edit in progress. It is never read by the
 *     storefront, so a half-finished rewrite of the hero can sit here for a
 *     week without anyone seeing it.
 *   - **`enabled`** is orthogonal to both: whether the section appears on
 *     the homepage at all. Disabling is how a seasonal banner is retired
 *     without losing the copy that took an hour to write.
 *
 * Every config that reaches the database is parsed by its own type's schema
 * from `section-schemas.ts` first — drafts included. A draft is an
 * unpublished config, not an excuse to store a shape nothing can render:
 * `getPublishedHomepageSections` skips a section whose config no longer
 * parses, and that skip should stay a diagnostic for hand-edited rows, not
 * a thing the admin screen can cause.
 */

export interface HomepageSectionRecord {
  id: string;
  type: HomepageSectionType;
  position: number;
  enabled: boolean;
  config: unknown;
  draftConfig: unknown | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(row: HomepageSection): HomepageSectionRecord {
  return {
    id: row.id,
    type: row.type,
    position: row.position,
    enabled: row.enabled,
    config: row.config,
    draftConfig: row.draftConfig ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Validate a config against the schema for its own type.
 *
 * Zod's own `ZodError` is already mapped to a `VALIDATION_FAILED` message by
 * `toAppError`, but that message says "check the highlighted fields" and
 * there are no highlighted fields here — the admin form has already checked
 * everything it can, so anything reaching this point is a shape mismatch
 * worth naming in the audit trail rather than a typo.
 */
function parseConfig(type: HomepageSectionType, config: unknown): Prisma.InputJsonValue {
  const result = sectionConfigSchemas[type].safeParse(config);
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', {
      internalMessage: `Invalid ${type} section config: ${JSON.stringify(result.error.issues)}`,
      details: { reasonCode: 'section_config_invalid' },
    });
  }
  return result.data as Prisma.InputJsonValue;
}

/** Every section, in homepage order — disabled ones included, because the
 * admin list is where a disabled section is found and brought back. */
export async function listHomepageSections(): Promise<HomepageSectionRecord[]> {
  const rows = await db.homepageSection.findMany({ orderBy: { position: 'asc' } });
  return rows.map(toRecord);
}

export async function getHomepageSection(id: string): Promise<HomepageSectionRecord | null> {
  const row = await db.homepageSection.findUnique({ where: { id } });
  return row ? toRecord(row) : null;
}

async function loadSection(id: string): Promise<HomepageSection> {
  const row = await db.homepageSection.findUnique({ where: { id } });
  if (!row) {
    throw new AppError('NOT_FOUND', { internalMessage: `Homepage section ${id} not found` });
  }
  return row;
}

export interface CreateHomepageSectionInput {
  type: HomepageSectionType;
  config: unknown;
  enabled?: boolean;
}

/**
 * A new section always goes last. Position is a plain integer rather than a
 * fractional rank: the list is a homepage, not a backlog — a store with more
 * than a dozen sections has a different problem than a renumbering cost.
 */
export async function createHomepageSection(
  input: CreateHomepageSectionInput,
): Promise<HomepageSectionRecord> {
  const config = parseConfig(input.type, input.config);

  const row = await db.$transaction(async (tx) => {
    const last = await tx.homepageSection.findFirst({
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return tx.homepageSection.create({
      data: {
        type: input.type,
        config,
        enabled: input.enabled ?? true,
        position: last ? last.position + 1 : 0,
      },
    });
  });

  return toRecord(row);
}

/**
 * Save an edit — as the published config or as a draft.
 *
 * `mode: 'publish'` writes `config` and clears any draft, because a draft
 * that survives its own publication is a trap: the next person opens the
 * section, sees the draft banner, and cannot tell whether it is newer or
 * older than what is live.
 */
export async function updateHomepageSectionConfig(
  id: string,
  config: unknown,
  mode: 'publish' | 'draft',
): Promise<HomepageSectionRecord> {
  const existing = await loadSection(id);
  const parsed = parseConfig(existing.type, config);

  const row = await db.homepageSection.update({
    where: { id },
    data:
      mode === 'publish' ? { config: parsed, draftConfig: Prisma.DbNull } : { draftConfig: parsed },
  });
  return toRecord(row);
}

/** Promote the stored draft to published. Refuses when there is no draft,
 * rather than republishing the current config and reporting success. */
export async function publishHomepageSectionDraft(id: string): Promise<HomepageSectionRecord> {
  const existing = await loadSection(id);
  if (existing.draftConfig === null || existing.draftConfig === undefined) {
    throw new AppError('CONFLICT', {
      internalMessage: `Homepage section ${id} has no draft to publish`,
      details: { reasonCode: 'section_has_no_draft' },
    });
  }

  const config = parseConfig(existing.type, existing.draftConfig);
  const row = await db.homepageSection.update({
    where: { id },
    data: { config, draftConfig: Prisma.DbNull },
  });
  return toRecord(row);
}

export async function discardHomepageSectionDraft(id: string): Promise<HomepageSectionRecord> {
  await loadSection(id);
  const row = await db.homepageSection.update({
    where: { id },
    data: { draftConfig: Prisma.DbNull },
  });
  return toRecord(row);
}

export async function setHomepageSectionEnabled(
  id: string,
  enabled: boolean,
): Promise<HomepageSectionRecord> {
  await loadSection(id);
  const row = await db.homepageSection.update({ where: { id }, data: { enabled } });
  return toRecord(row);
}

export async function deleteHomepageSection(id: string): Promise<HomepageSectionRecord> {
  const existing = await loadSection(id);
  await db.homepageSection.delete({ where: { id } });
  return toRecord(existing);
}

/**
 * Rewrite the whole order from a list of ids.
 *
 * Takes every id rather than "move this one up": the admin list already
 * knows the full order, and sending it whole makes the operation idempotent
 * and impossible to half-apply. An id that isn't a real section, or a list
 * that doesn't name every section exactly once, is rejected before anything
 * is written — a partial reorder would leave two sections sharing a
 * position and the homepage order would then depend on insertion order.
 */
export async function reorderHomepageSections(
  orderedIds: string[],
): Promise<HomepageSectionRecord[]> {
  const existing = await db.homepageSection.findMany({ select: { id: true } });
  const existingIds = new Set(existing.map((row) => row.id));

  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (!existingIds.has(id) || seen.has(id)) {
      throw new AppError('VALIDATION_FAILED', {
        internalMessage: `Reorder list names an unknown or duplicated section: ${id}`,
        details: { reasonCode: 'section_order_mismatch' },
      });
    }
    seen.add(id);
  }
  if (seen.size !== existingIds.size) {
    throw new AppError('VALIDATION_FAILED', {
      internalMessage: `Reorder list has ${seen.size} ids for ${existingIds.size} sections`,
      details: { reasonCode: 'section_order_mismatch' },
    });
  }

  await db.$transaction(
    orderedIds.map((id, index) =>
      db.homepageSection.update({ where: { id }, data: { position: index } }),
    ),
  );

  return listHomepageSections();
}

/**
 * The `titleAr`/`titleEn` a section carries, for the admin list.
 *
 * Every one of the ten config shapes has both keys — required on the ones
 * that render a heading, optional on the rails — so this reads them
 * generically rather than switching on ten types to fetch the same two
 * fields. `null` means the section genuinely has no title (an untitled
 * rail), which the list renders as its type name rather than as a blank
 * cell.
 */
export function getSectionHeadline(config: unknown): { ar: string | null; en: string | null } {
  if (typeof config !== 'object' || config === null) return { ar: null, en: null };
  const record = config as Record<string, unknown>;
  const read = (key: string): string | null => {
    const value = record[key];
    return typeof value === 'string' && value.trim() !== '' ? value : null;
  };
  return { ar: read('titleAr'), en: read('titleEn') };
}
