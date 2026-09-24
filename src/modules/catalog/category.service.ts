import type { Category } from '@generated/prisma';

import { db } from '@/modules/core';
import { AppError } from '@/modules/core';

import {
  categoryInputSchema,
  categoryUpdateSchema,
  type CategoryInput,
  type CategoryUpdateInput,
} from './schemas';
import { mapUniqueConstraint, mapForeignKeyRestrict } from './prisma-errors';

export interface CategoryNode extends Category {
  children: CategoryNode[];
}

export async function createCategory(input: CategoryInput): Promise<Category> {
  const parsed = categoryInputSchema.parse(input);
  if (parsed.parentId) await getCategoryOrThrow(parsed.parentId);

  try {
    return await db.category.create({ data: parsed });
  } catch (error) {
    throw mapUniqueConstraint(error, 'slug');
  }
}

export async function updateCategory(id: string, input: CategoryUpdateInput): Promise<Category> {
  const parsed = categoryUpdateSchema.parse(input);
  await getCategoryOrThrow(id);

  if (parsed.parentId !== undefined && parsed.parentId !== null) {
    if (parsed.parentId === id) {
      throw new AppError('VALIDATION_FAILED', {
        details: { reason: 'A category cannot be its own parent' },
      });
    }
    await getCategoryOrThrow(parsed.parentId);
    await assertNoCycle(id, parsed.parentId);
  }

  try {
    return await db.category.update({ where: { id }, data: parsed });
  } catch (error) {
    throw mapUniqueConstraint(error, 'slug');
  }
}

/**
 * Reorders siblings under one parent (or the top level, for `parentId: null`)
 * to match `orderedIds` exactly — position 0 first. All-or-nothing: a
 * category id that isn't actually a child of `parentId` fails the whole call
 * rather than silently reordering a subset.
 */
export async function reorderCategories(
  parentId: string | null,
  orderedIds: string[],
): Promise<void> {
  const siblings = await db.category.findMany({ where: { parentId }, select: { id: true } });
  const siblingIds = new Set(siblings.map((s) => s.id));

  if (orderedIds.length !== siblingIds.size || orderedIds.some((id) => !siblingIds.has(id))) {
    throw new AppError('VALIDATION_FAILED', {
      details: { reason: 'orderedIds must be exactly the current children of parentId' },
    });
  }

  await db.$transaction(
    orderedIds.map((id, position) => db.category.update({ where: { id }, data: { position } })),
  );
}

/**
 * Removes a category outright — safe only for a genuinely empty one. Checked
 * explicitly first (for a specific, actionable reason) even though the
 * database's own `onDelete: Restrict` on `Category.parent` and
 * `Product.category` would refuse the delete either way; this just turns
 * that into "it has N subcategories" or "it has N products" instead of a
 * generic conflict.
 */
export async function deleteCategory(id: string): Promise<void> {
  await getCategoryOrThrow(id);

  const [childCount, productCount] = await Promise.all([
    db.category.count({ where: { parentId: id } }),
    db.product.count({ where: { categoryId: id } }),
  ]);

  if (childCount > 0) {
    throw new AppError('CONFLICT', {
      internalMessage: `Category has ${childCount} subcategories`,
      // `reasonCode` + `count`, not a pre-formatted sentence: the domain
      // layer names *what* happened in a fixed, locale-free vocabulary; the
      // admin UI (`admin-dictionary.ts`'s `errors` section) owns turning
      // that into an actual bilingual sentence. Keeps this file free of any
      // language's copy, the same separation `AppError.userMessage` already
      // draws at the top level.
      details: { reasonCode: 'category_has_subcategories', count: childCount },
    });
  }
  if (productCount > 0) {
    throw new AppError('CONFLICT', {
      internalMessage: `Category has ${productCount} products assigned`,
      details: { reasonCode: 'category_has_products', count: productCount },
    });
  }

  try {
    await db.category.delete({ where: { id } });
  } catch (error) {
    throw mapForeignKeyRestrict(error, 'category_still_referenced');
  }
}

export async function getCategory(id: string): Promise<Category | null> {
  return db.category.findUnique({ where: { id } });
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  return db.category.findUnique({ where: { slug } });
}

/** Root-to-leaf ancestor chain, `[...ancestors, self]`. The basis for
 * attribute inheritance (`attribute.service.ts`) and breadcrumbs alike. */
export async function getAncestorChain(categoryId: string): Promise<Category[]> {
  const chain: Category[] = [];
  const seen = new Set<string>();
  let current = await getCategoryOrThrow(categoryId);

  while (true) {
    if (seen.has(current.id)) {
      // A cycle should be structurally impossible (assertNoCycle guards every
      // write), but a read path never trusts that and loops forever instead.
      throw new AppError('INTERNAL', {
        internalMessage: `Circular category hierarchy detected at ${current.id}`,
      });
    }
    seen.add(current.id);
    chain.unshift(current);
    if (!current.parentId) break;
    current = await getCategoryOrThrow(current.parentId);
  }

  return chain;
}

/** The full tree, or the subtree rooted at `rootId`. */
export async function getCategoryTree(rootId?: string): Promise<CategoryNode[]> {
  const all = await db.category.findMany({ orderBy: [{ parentId: 'asc' }, { position: 'asc' }] });
  const byParent = new Map<string | null, Category[]>();
  for (const category of all) {
    const list = byParent.get(category.parentId) ?? [];
    list.push(category);
    byParent.set(category.parentId, list);
  }

  function build(parentId: string | null): CategoryNode[] {
    return (byParent.get(parentId) ?? []).map((category) => ({
      ...category,
      children: build(category.id),
    }));
  }

  if (!rootId) return build(null);
  const root = all.find((c) => c.id === rootId);
  if (!root) throw new AppError('NOT_FOUND', { details: { entity: 'Category', id: rootId } });
  return [{ ...root, children: build(root.id) }];
}

export interface CategoryNodeWithProductCount extends CategoryNode {
  productCount: number;
  children: CategoryNodeWithProductCount[];
}

/** The same tree `getCategoryTree` returns, with each node's own direct
 * product count attached — what the admin category list shows (P07 §4).
 * Direct count only, not the descendant-inclusive scope
 * `getDescendantCategoryIds` computes for storefront browsing: an admin
 * managing "Cars" wants to know it can't be deleted because it itself has
 * 3 products, not because "SUVs" under it does. */
export async function getCategoryTreeWithProductCounts(): Promise<CategoryNodeWithProductCount[]> {
  const [tree, counts] = await Promise.all([
    getCategoryTree(),
    db.product.groupBy({ by: ['categoryId'], _count: { _all: true } }),
  ]);
  const countByCategory = new Map(counts.map((c) => [c.categoryId, c._count._all]));

  function attach(node: CategoryNode): CategoryNodeWithProductCount {
    return {
      ...node,
      productCount: countByCategory.get(node.id) ?? 0,
      children: node.children.map(attach),
    };
  }

  return tree.map(attach);
}

/** `categoryId` plus every descendant's id — the scope a category listing
 * page shows products for, since browsing "Cars" should include "SUVs"
 * under it, not just products tagged directly on "Cars" itself. */
export async function getDescendantCategoryIds(categoryId: string): Promise<string[]> {
  const [root] = await getCategoryTree(categoryId);
  if (!root) return [categoryId];

  const ids: string[] = [];
  function collect(node: CategoryNode): void {
    ids.push(node.id);
    for (const child of node.children) collect(child);
  }
  collect(root);
  return ids;
}

async function getCategoryOrThrow(id: string): Promise<Category> {
  const category = await getCategory(id);
  if (!category) throw new AppError('NOT_FOUND', { details: { entity: 'Category', id } });
  return category;
}

/** Walks up from `proposedParentId`; if that walk ever reaches `categoryId`,
 * assigning `proposedParentId` as its parent would create a cycle. */
async function assertNoCycle(categoryId: string, proposedParentId: string): Promise<void> {
  let currentId: string | null = proposedParentId;
  const seen = new Set<string>();

  while (currentId) {
    if (currentId === categoryId) {
      throw new AppError('VALIDATION_FAILED', {
        details: {
          reason: 'Circular category hierarchy: the new parent is a descendant of this category',
        },
      });
    }
    if (seen.has(currentId)) break; // pre-existing cycle, not this call's to report
    seen.add(currentId);
    const parent: { parentId: string | null } | null = await db.category.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    currentId = parent?.parentId ?? null;
  }
}
