import 'server-only';

import { revalidatePath } from 'next/cache';

import { getCategory } from '@/modules/catalog';
import { SUPPORTED_LOCALES } from '@/lib/i18n/locales';

/**
 * Publishing, editing or archiving a product has to show up in the store,
 * not in a minute's time.
 *
 * The storefront's product, category and home pages are all ISR
 * (`export const revalidate = 60`), which is right for traffic but wrong
 * for an admin who just pressed Publish and immediately checks the result —
 * without this they would see the old page for up to a minute and
 * reasonably conclude the save failed. Every admin mutation that changes
 * what a customer sees calls this, so the change is visible on the next
 * request rather than on the next revalidation window.
 *
 * All four affected paths, for both locales:
 *   - the product page itself,
 *   - its category page (listings show price, stock and name),
 *   - the homepage (featured/new sections read from the same products).
 */
export async function revalidateStorefrontForProduct(product: {
  slug: string;
  categoryId: string;
}): Promise<void> {
  const category = await getCategory(product.categoryId);

  for (const locale of SUPPORTED_LOCALES) {
    revalidatePath(`/${locale}/p/${product.slug}`);
    if (category) revalidatePath(`/${locale}/c/${category.slug}`);
    revalidatePath(`/${locale}`);
  }
}
