'use server';

import { revalidatePath } from 'next/cache';
import type { HomepageSectionType } from '@generated/prisma';

import { adminErrorMessage } from '@/lib/admin/admin-error-message';
import { recordAuditEvent, requirePermission } from '@/modules/identity';
import {
  createHomepageSection,
  deleteHomepageSection,
  discardHomepageSectionDraft,
  getSectionHeadline,
  publishHomepageSectionDraft,
  reorderHomepageSections,
  setHomepageSectionEnabled,
  updateHomepageSectionConfig,
} from '@/modules/content';
import { getCategoryTree, getProduct, listProductsForAdmin } from '@/modules/catalog';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/i18n/locales';
import type { ActionResult } from '@/lib/admin/action-result';

/**
 * Homepage content (P15) — the actions behind `/admin/content`.
 *
 * Same shape as every other admin action file: `requirePermission` first,
 * then the domain service, then an audit event, then revalidate. Two things
 * are specific to this one:
 *
 *   - **`content.manage` gates all of it,** including the two picker
 *     searches at the bottom. A picker is a read, but it is a read of the
 *     whole catalog through a screen only content managers reach, so it is
 *     checked like everything else here rather than left open because
 *     "it's only a dropdown".
 *   - **Every write revalidates the homepage itself,** in both locales.
 *     `/admin/content` shows the change immediately either way; the point of
 *     this screen is the *public* page, and an admin who publishes a hero
 *     and then opens the store to check must not be shown the ISR copy from
 *     up to a minute ago and conclude the save failed. Same reasoning as
 *     `revalidate-storefront.ts`, which this deliberately does not reuse:
 *     that one resolves a product's own category page, and a section has
 *     neither.
 */
function revalidateHomepage(): void {
  for (const locale of SUPPORTED_LOCALES) revalidatePath(`/${locale}`);
  revalidatePath('/admin/content');
}

export interface CreateSectionActionInput {
  type: HomepageSectionType;
  config: unknown;
  enabled: boolean;
}

export async function createHomepageSectionAction(
  input: CreateSectionActionInput,
  locale: Locale,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission('content.manage');
    const section = await createHomepageSection(input);

    await recordAuditEvent({
      action: 'content.section_created',
      entityType: 'HomepageSection',
      userId: actor.id,
      entityId: section.id,
      // The type and title, not the whole config: a config can carry a
      // hundred curated product ids, and the question an audit entry
      // answers is "who added a section, and which one".
      after: {
        type: section.type,
        position: section.position,
        enabled: section.enabled,
        ...getSectionHeadline(section.config),
      },
    });

    revalidateHomepage();
    return { ok: true, data: { id: section.id } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function updateHomepageSectionAction(
  id: string,
  config: unknown,
  mode: 'publish' | 'draft',
  locale: Locale,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission('content.manage');
    const section = await updateHomepageSectionConfig(id, config, mode);

    await recordAuditEvent({
      action: mode === 'publish' ? 'content.section_published' : 'content.section_updated',
      entityType: 'HomepageSection',
      userId: actor.id,
      entityId: section.id,
      after: {
        type: section.type,
        mode,
        ...getSectionHeadline(mode === 'publish' ? section.config : section.draftConfig),
      },
    });

    // A draft changes nothing a visitor can see, so it does not invalidate
    // the storefront's cached homepage — only the admin screen that shows
    // the "draft pending" badge.
    if (mode === 'publish') revalidateHomepage();
    else revalidatePath('/admin/content');

    return { ok: true, data: { id: section.id } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function publishHomepageSectionDraftAction(
  id: string,
  locale: Locale,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission('content.manage');
    const section = await publishHomepageSectionDraft(id);

    await recordAuditEvent({
      action: 'content.section_published',
      entityType: 'HomepageSection',
      userId: actor.id,
      entityId: section.id,
      after: { type: section.type, fromDraft: true, ...getSectionHeadline(section.config) },
    });

    revalidateHomepage();
    return { ok: true, data: { id: section.id } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function discardHomepageSectionDraftAction(
  id: string,
  locale: Locale,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission('content.manage');
    const section = await discardHomepageSectionDraft(id);

    await recordAuditEvent({
      action: 'content.section_updated',
      entityType: 'HomepageSection',
      userId: actor.id,
      entityId: section.id,
      after: { type: section.type, draftDiscarded: true },
    });

    revalidatePath('/admin/content');
    return { ok: true, data: { id: section.id } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function setHomepageSectionEnabledAction(
  id: string,
  enabled: boolean,
  locale: Locale,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission('content.manage');
    const section = await setHomepageSectionEnabled(id, enabled);

    await recordAuditEvent({
      action: enabled ? 'content.section_enabled' : 'content.section_disabled',
      entityType: 'HomepageSection',
      userId: actor.id,
      entityId: section.id,
      after: { type: section.type, enabled, ...getSectionHeadline(section.config) },
    });

    revalidateHomepage();
    return { ok: true, data: { id: section.id } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function deleteHomepageSectionAction(
  id: string,
  locale: Locale,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission('content.manage');
    const section = await deleteHomepageSection(id);

    await recordAuditEvent({
      action: 'content.section_deleted',
      entityType: 'HomepageSection',
      userId: actor.id,
      entityId: section.id,
      // `before`, not `after`: the row is gone, and what the log is for is
      // saying what was there.
      before: {
        type: section.type,
        position: section.position,
        ...getSectionHeadline(section.config),
      },
    });

    revalidateHomepage();
    return { ok: true, data: { id: section.id } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function reorderHomepageSectionsAction(
  orderedIds: string[],
  locale: Locale,
): Promise<ActionResult<{ order: string[] }>> {
  try {
    const actor = await requirePermission('content.manage');
    const sections = await reorderHomepageSections(orderedIds);

    await recordAuditEvent({
      action: 'content.sections_reordered',
      entityType: 'HomepageSection',
      userId: actor.id,
      // No single section is the subject of a reorder, so the entry names
      // the resulting order rather than pretending one row changed.
      // `recordAuditEvent` then falls back to the acting admin's id for
      // `entityId`, which is the only useful answer for this event.
      after: { order: sections.map((section) => `${section.position}:${section.type}`) },
    });

    revalidateHomepage();
    return { ok: true, data: { order: sections.map((section) => section.id) } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

/**
 * The two pickers a section form needs.
 *
 * A product rail curates ids, and a store with ten thousand products cannot
 * ship its catalog into a `<select>` — the same constraint `scope-search-
 * actions.ts` solved for promotions, and for the same reason this is a
 * search rather than a list. Categories are a bounded tree and are handed
 * over whole.
 */
export interface ContentPickerOption {
  id: string;
  label: string;
  hint: string | null;
  /** Whether this product is actually PUBLISHED. A rail curates ids, and
   * the storefront resolves them through `listProducts`, which returns only
   * published products — so curating a draft silently produces a shorter
   * rail than the admin picked. The picker says so instead. */
  published: boolean;
}

const MAX_PICKER_RESULTS = 20;

export async function searchProductsForContentAction(
  query: string,
  locale: Locale,
): Promise<ContentPickerOption[]> {
  await requirePermission('content.manage');

  const term = query.trim();
  if (term.length < 2) return [];

  const result = await listProductsForAdmin({
    q: term,
    pageSize: MAX_PICKER_RESULTS,
    sort: 'name-asc',
  });

  return result.items.map((item) => ({
    id: item.id,
    label: locale === 'ar' ? item.nameAr : item.nameEn,
    hint: item.skuSummary || null,
    published: item.status === 'PUBLISHED',
  }));
}

export async function listCategoriesForContentAction(
  locale: Locale,
): Promise<ContentPickerOption[]> {
  await requirePermission('content.manage');

  const tree = await getCategoryTree();
  const flatten = (
    nodes: Awaited<ReturnType<typeof getCategoryTree>>,
    depth = 0,
  ): ContentPickerOption[] =>
    nodes.flatMap((node) => [
      {
        id: node.id,
        label: `${'— '.repeat(depth)}${locale === 'ar' ? node.nameAr : node.nameEn}`,
        hint: null,
        published: true,
      },
      ...flatten(node.children, depth + 1),
    ]);

  return flatten(tree);
}

/**
 * Resolve already-curated ids back into labels when an edit form loads.
 *
 * Without this, opening a saved product rail would show a list of UUIDs and
 * the only safe move would be to re-pick everything. An id whose product
 * has since been deleted simply doesn't come back — the form then shows one
 * fewer chip rather than a broken one, which is also exactly what the
 * storefront does with it (`resolveProducts` in `homepage.service.ts`).
 *
 * Resolved one id at a time on purpose: a rail curates a handful of
 * products, and `listProductsForAdmin` has no "these ids" filter to add for
 * a caller this small.
 */
export async function resolveProductLabelsAction(
  productIds: string[],
  locale: Locale,
): Promise<ContentPickerOption[]> {
  await requirePermission('content.manage');

  const products = await Promise.all(productIds.map((id) => getProduct(id)));

  return products
    .map<ContentPickerOption | null>((product) =>
      product && product.deletedAt === null
        ? {
            id: product.id,
            label: locale === 'ar' ? product.nameAr : product.nameEn,
            hint: null,
            published: product.status === 'PUBLISHED',
          }
        : null,
    )
    .filter((option): option is ContentPickerOption => option !== null);
}
