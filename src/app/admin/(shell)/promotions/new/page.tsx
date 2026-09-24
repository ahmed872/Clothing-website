import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { listScopeTargetsAction } from '@/lib/admin/scope-search-actions';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { PromotionForm } from '@/components/admin/promotion-form';

import { promotionFormLabels } from '../promotion-labels';

export const metadata: Metadata = { title: 'New promotion' };

export default async function NewPromotionPage() {
  await requireAdminPermission('discounts.manage');

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  const { categories, brands } = await listScopeTargetsAction(locale);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.promotions.newPromotion}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[
              { label: t.promotions.title, href: '/admin/promotions' },
              { label: t.promotions.newPromotion },
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
          id: null,
          code: '',
          type: 'PERCENTAGE',
          value: 10,
          descriptionAr: '',
          descriptionEn: '',
          minOrderMinor: null,
          maxDiscountMinor: null,
          usageLimit: null,
          perCustomerLimit: null,
          startsAt: '',
          endsAt: '',
          active: true,
          scopes: [],
          updatedAt: null,
        }}
      />
    </div>
  );
}
