import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';

import { getCoupon } from '@/modules/pricing';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale, type Locale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { listScopeTargetsAction } from '@/lib/admin/scope-search-actions';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { PromotionForm } from '@/components/admin/promotion-form';
import type { ScopeSelection } from '@/components/admin/scope-picker';

import { promotionFormLabels } from '../promotion-labels';

export const metadata: Metadata = { title: 'Edit promotion' };

/** A scope stores an id; the form shows a name. Resolving them here means
 * the picker never has to fetch the catalog just to label what is already
 * selected. */
async function labelScopes(
  scopes: { scopeType: 'PRODUCT' | 'CATEGORY' | 'BRAND'; targetId: string }[],
  locale: Locale,
): Promise<ScopeSelection[]> {
  const { categories, brands } = await listScopeTargetsAction(locale);
  const byId = new Map<string, string>();
  for (const option of [...categories, ...brands]) byId.set(option.id, option.label);

  const { db } = await import('@/modules/core');
  const productIds = scopes.filter((s) => s.scopeType === 'PRODUCT').map((s) => s.targetId);
  if (productIds.length > 0) {
    const products = await db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, nameAr: true, nameEn: true },
    });
    for (const product of products) {
      byId.set(product.id, locale === 'ar' ? product.nameAr : product.nameEn);
    }
  }

  return scopes.map((scope) => ({
    scopeType: scope.scopeType,
    targetId: scope.targetId,
    label: byId.get(scope.targetId) ?? scope.targetId,
  }));
}

export default async function EditPromotionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPermission('discounts.manage');

  const { id } = await params;
  const coupon = await getCoupon(id);
  if (!coupon) notFound();

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  const [{ categories, brands }, scopes] = await Promise.all([
    listScopeTargetsAction(locale),
    labelScopes(coupon.scopes, locale),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.promotions.editPromotion}
        description={coupon.code}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[
              { label: t.promotions.title, href: '/admin/promotions' },
              { label: coupon.code },
            ]}
          />
        }
      />

      <PromotionForm
        locale={locale}
        labels={promotionFormLabels(t)}
        categories={categories}
        brands={brands}
        initial={{
          id: coupon.id,
          code: coupon.code,
          type: coupon.type,
          value: coupon.value,
          descriptionAr: coupon.descriptionAr ?? '',
          descriptionEn: coupon.descriptionEn ?? '',
          minOrderMinor: coupon.minOrderMinor,
          maxDiscountMinor: coupon.maxDiscountMinor,
          usageLimit: coupon.usageLimit,
          perCustomerLimit: coupon.perCustomerLimit,
          startsAt: coupon.startsAt?.toISOString() ?? '',
          endsAt: coupon.endsAt?.toISOString() ?? '',
          active: coupon.active,
          scopes,
          updatedAt: coupon.updatedAt.toISOString(),
        }}
      />
    </div>
  );
}
