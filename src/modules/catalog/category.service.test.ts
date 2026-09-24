import { beforeEach, describe, expect, it } from 'vitest';

import {
  createCategory,
  updateCategory,
  reorderCategories,
  deleteCategory,
  getCategory,
  getCategoryBySlug,
  getAncestorChain,
  getCategoryTree,
  getCategoryTreeWithProductCounts,
} from './category.service';
import { createProduct } from './product.service';
import { resetCatalogTables } from './testing';
import type { CreateProductInput } from './schemas';

beforeEach(async () => {
  await resetCatalogTables();
});

function categoryInput(overrides: Partial<Parameters<typeof createCategory>[0]> = {}) {
  return {
    slug: 'cars',
    nameAr: 'سيارات',
    nameEn: 'Cars',
    ...overrides,
  };
}

describe('createCategory', () => {
  it('creates a top-level category', async () => {
    const category = await createCategory(categoryInput());
    expect(category.slug).toBe('cars');
    expect(category.parentId).toBeNull();
  });

  it('creates a nested category under an existing parent', async () => {
    const parent = await createCategory(categoryInput());
    const child = await createCategory(
      categoryInput({ slug: 'sedans', nameAr: 'سيدان', nameEn: 'Sedans', parentId: parent.id }),
    );
    expect(child.parentId).toBe(parent.id);
  });

  it('rejects a duplicate slug', async () => {
    await createCategory(categoryInput());
    // The `reasonCode` matters as much as the code: without it the admin UI
    // falls back to `CONFLICT`'s generic "this changed somewhere else"
    // message, which is what a stale-version conflict says and reads as
    // actively wrong on a duplicate slug.
    await expect(createCategory(categoryInput())).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reasonCode: 'duplicate_slug' },
    });
  });

  it('rejects a parent that does not exist', async () => {
    await expect(
      createCategory(categoryInput({ parentId: '00000000-0000-0000-0000-000000000000' })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects an invalid slug', async () => {
    await expect(createCategory(categoryInput({ slug: 'Not A Slug!' }))).rejects.toThrow();
  });
});

describe('updateCategory', () => {
  it('updates fields', async () => {
    const category = await createCategory(categoryInput());
    const updated = await updateCategory(category.id, { nameEn: 'Automobiles' });
    expect(updated.nameEn).toBe('Automobiles');
  });

  it('moves a category under a new, valid parent', async () => {
    const a = await createCategory(categoryInput({ slug: 'a', nameAr: 'أ', nameEn: 'A' }));
    const b = await createCategory(categoryInput({ slug: 'b', nameAr: 'ب', nameEn: 'B' }));
    const moved = await updateCategory(b.id, { parentId: a.id });
    expect(moved.parentId).toBe(a.id);
  });

  it('rejects a category being its own parent', async () => {
    const category = await createCategory(categoryInput());
    await expect(updateCategory(category.id, { parentId: category.id })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it("rejects a circular hierarchy (direct: parent becomes its own child's child)", async () => {
    const parent = await createCategory(
      categoryInput({ slug: 'parent', nameAr: 'أب', nameEn: 'Parent' }),
    );
    const child = await createCategory(
      categoryInput({ slug: 'child', nameAr: 'ابن', nameEn: 'Child', parentId: parent.id }),
    );
    await expect(updateCategory(parent.id, { parentId: child.id })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('rejects a circular hierarchy several levels deep', async () => {
    const a = await createCategory(categoryInput({ slug: 'a', nameAr: 'أ', nameEn: 'A' }));
    const b = await createCategory(
      categoryInput({ slug: 'b', nameAr: 'ب', nameEn: 'B', parentId: a.id }),
    );
    const c = await createCategory(
      categoryInput({ slug: 'c', nameAr: 'ج', nameEn: 'C', parentId: b.id }),
    );
    // a -> b -> c ; making a's parent = c would close the loop a -> b -> c -> a
    await expect(updateCategory(a.id, { parentId: c.id })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    // the hierarchy is unchanged
    expect((await getCategory(a.id))?.parentId).toBeNull();
  });
});

describe('reorderCategories', () => {
  it('applies the given order as position', async () => {
    const a = await createCategory(categoryInput({ slug: 'a', nameAr: 'أ', nameEn: 'A' }));
    const b = await createCategory(categoryInput({ slug: 'b', nameAr: 'ب', nameEn: 'B' }));
    const c = await createCategory(categoryInput({ slug: 'c', nameAr: 'ج', nameEn: 'C' }));

    await reorderCategories(null, [c.id, a.id, b.id]);

    expect((await getCategory(c.id))?.position).toBe(0);
    expect((await getCategory(a.id))?.position).toBe(1);
    expect((await getCategory(b.id))?.position).toBe(2);
  });

  it('rejects an order that omits or adds a sibling', async () => {
    const a = await createCategory(categoryInput({ slug: 'a', nameAr: 'أ', nameEn: 'A' }));
    await createCategory(categoryInput({ slug: 'b', nameAr: 'ب', nameEn: 'B' }));
    await expect(reorderCategories(null, [a.id])).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('getAncestorChain', () => {
  it('returns [self] for a root category', async () => {
    const root = await createCategory(categoryInput());
    const chain = await getAncestorChain(root.id);
    expect(chain.map((c) => c.id)).toEqual([root.id]);
  });

  it('returns [root, ..., self] for a nested category', async () => {
    const a = await createCategory(categoryInput({ slug: 'a', nameAr: 'أ', nameEn: 'A' }));
    const b = await createCategory(
      categoryInput({ slug: 'b', nameAr: 'ب', nameEn: 'B', parentId: a.id }),
    );
    const c = await createCategory(
      categoryInput({ slug: 'c', nameAr: 'ج', nameEn: 'C', parentId: b.id }),
    );
    const chain = await getAncestorChain(c.id);
    expect(chain.map((cat) => cat.id)).toEqual([a.id, b.id, c.id]);
  });
});

describe('getCategoryTree', () => {
  it('nests children under their parent', async () => {
    const root = await createCategory(categoryInput());
    const child = await createCategory(
      categoryInput({ slug: 'sedans', nameAr: 'سيدان', nameEn: 'Sedans', parentId: root.id }),
    );

    const tree = await getCategoryTree();
    const rootNode = tree.find((n) => n.id === root.id);
    expect(rootNode?.children.map((c) => c.id)).toEqual([child.id]);
  });
});

describe('getCategoryTreeWithProductCounts', () => {
  it('attaches each category its own direct product count', async () => {
    const root = await createCategory(categoryInput());
    const child = await createCategory(
      categoryInput({ slug: 'sedans', nameAr: 'سيدان', nameEn: 'Sedans', parentId: root.id }),
    );
    const input: CreateProductInput = {
      product: { slug: 'sedan-1', nameAr: 'سيدان', nameEn: 'Sedan', categoryId: child.id },
      variants: [{ sku: 'SEDAN-1', priceMinor: 100000 }],
    };
    await createProduct(input);

    const tree = await getCategoryTreeWithProductCounts();
    const rootNode = tree.find((n) => n.id === root.id);
    // The product sits on the child, so the parent's own count stays 0 —
    // this is the direct count the admin delete guard uses, not the
    // descendant-inclusive scope storefront browsing needs.
    expect(rootNode?.productCount).toBe(0);
    expect(rootNode?.children[0]?.productCount).toBe(1);
  });
});

describe('getCategoryBySlug', () => {
  it('finds a category by its slug', async () => {
    await createCategory(categoryInput());
    const found = await getCategoryBySlug('cars');
    expect(found?.slug).toBe('cars');
  });

  it('returns null for a slug that does not exist', async () => {
    expect(await getCategoryBySlug('does-not-exist')).toBeNull();
  });
});

describe('deleteCategory', () => {
  it('deletes an empty leaf category', async () => {
    const category = await createCategory(categoryInput());
    await deleteCategory(category.id);
    expect(await getCategory(category.id)).toBeNull();
  });

  it('refuses to delete a category that has subcategories', async () => {
    const root = await createCategory(categoryInput());
    await createCategory(
      categoryInput({ slug: 'sedans', nameAr: 'سيدان', nameEn: 'Sedans', parentId: root.id }),
    );
    await expect(deleteCategory(root.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses to delete a category that has products assigned', async () => {
    const category = await createCategory(categoryInput());
    const input: CreateProductInput = {
      product: { slug: 'car-1', nameAr: 'سيارة', nameEn: 'Car', categoryId: category.id },
      variants: [{ sku: 'CAR-1', priceMinor: 100000 }],
    };
    await createProduct(input);
    await expect(deleteCategory(category.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects an id that does not exist', async () => {
    await expect(deleteCategory('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
