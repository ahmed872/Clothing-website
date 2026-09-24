'use server';

import { requirePermission } from '@/modules/identity';
import { listVariantsForAdmin, listBrands, getCategoryTree } from '@/modules/catalog';
import type { Locale } from '@/lib/i18n/locales';

/**
 * Search for something a promotion can be scoped to (P09 §13).
 *
 * A store with ten thousand products cannot ship its catalog into a form's
 * `<select>`, so the picker asks the server as the admin types and never
 * receives more than a page of matches. Categories and brands are small
 * enough to send whole, and are loaded once by the page rather than
 * repeatedly by the field.
 */

export interface ScopeOption {
  id: string;
  label: string;
  hint: string | null;
}

const MAX_RESULTS = 20;

export async function searchProductsForScopeAction(
  query: string,
  locale: Locale,
): Promise<ScopeOption[]> {
  await requirePermission('discounts.manage');

  const term = query.trim();
  if (term.length < 2) return [];

  // Reuses the variant listing that already powers inventory and pricing,
  // then collapses to distinct products — the promotion scope is a product,
  // not a variant, and there is no second search implementation to keep in
  // step with this one.
  const result = await listVariantsForAdmin({ q: term, pageSize: 100, sort: 'sku-asc' });

  const byProduct = new Map<string, ScopeOption>();
  for (const item of result.items) {
    if (byProduct.has(item.productId)) continue;
    byProduct.set(item.productId, {
      id: item.productId,
      label: locale === 'ar' ? item.productNameAr : item.productNameEn,
      hint: item.sku,
    });
    if (byProduct.size >= MAX_RESULTS) break;
  }

  return [...byProduct.values()];
}

export async function listScopeTargetsAction(
  locale: Locale,
): Promise<{ categories: ScopeOption[]; brands: ScopeOption[] }> {
  await requirePermission('discounts.manage');

  const [tree, brands] = await Promise.all([getCategoryTree(), listBrands()]);

  const flatten = (nodes: Awaited<ReturnType<typeof getCategoryTree>>, depth = 0): ScopeOption[] =>
    nodes.flatMap((node) => [
      {
        id: node.id,
        label: `${'— '.repeat(depth)}${locale === 'ar' ? node.nameAr : node.nameEn}`,
        hint: null,
      },
      ...flatten(node.children, depth + 1),
    ]);

  return {
    categories: flatten(tree),
    brands: brands.map((brand) => ({
      id: brand.id,
      label: locale === 'ar' ? brand.nameAr : brand.nameEn,
      hint: null,
    })),
  };
}
