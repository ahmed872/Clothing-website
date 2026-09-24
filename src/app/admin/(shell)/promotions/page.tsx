import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { Plus } from 'lucide-react';

import { listCoupons, type CouponSort, type CouponStatusFilter } from '@/modules/pricing';
import { formatMoney } from '@/modules/core';
import { getStoreSettings } from '@/modules/settings';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { formatAdminDate } from '@/lib/admin/format-admin-date';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { QueryToolbar } from '@/components/admin/query-toolbar';
import { PromotionsTable, type PromotionRow } from '@/components/admin/promotions-table';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Promotions' };

const SORTS: CouponSort[] = ['created-desc', 'created-asc', 'code-asc', 'ends-asc'];
const STATUSES: CouponStatusFilter[] = ['active', 'inactive', 'scheduled', 'expired'];

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export default async function AdminPromotionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPermission('discounts.manage');

  const params = await searchParams;
  const one = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  const typeParam = one('type');
  const [result, settings] = await Promise.all([
    listCoupons({
      q: one('q') || undefined,
      type: typeParam === 'PERCENTAGE' || typeParam === 'FIXED' ? typeParam : undefined,
      status: STATUSES.find((status) => status === one('status')),
      sort: SORTS.find((sort) => sort === one('sort')) ?? 'created-desc',
      page: parsePositiveInt(one('page')) ?? 1,
    }),
    getStoreSettings(locale),
  ]);

  const now = new Date();
  const rows: PromotionRow[] = result.items.map((item) => {
    const expired = item.endsAt !== null && item.endsAt < now;
    const scheduled = item.startsAt !== null && item.startsAt > now;
    const status = !item.active
      ? ('inactive' as const)
      : expired
        ? ('expired' as const)
        : scheduled
          ? ('scheduled' as const)
          : ('active' as const);

    return {
      id: item.id,
      code: item.code,
      type: item.type,
      // Formatted on the server: a percentage and an amount are different
      // shapes, and money formatting needs the store's currency.
      valueLabel:
        item.type === 'PERCENTAGE'
          ? `${item.value}%`
          : formatMoney(item.value, { locale, currency: settings.currency }),
      minOrderLabel:
        item.minOrderMinor === null
          ? null
          : formatMoney(item.minOrderMinor, { locale, currency: settings.currency }),
      usageLabel:
        item.usageLimit === null
          ? t.promotions.usageUnlimited.replace('{used}', String(item.redemptionCount))
          : t.promotions.usageOf
              .replace('{used}', String(item.redemptionCount))
              .replace('{limit}', String(item.usageLimit)),
      windowLabel:
        item.startsAt === null && item.endsAt === null
          ? t.promotions.noWindow
          : [
              item.startsAt ? formatAdminDate(item.startsAt, locale) : '—',
              item.endsAt ? formatAdminDate(item.endsAt, locale) : '—',
            ].join(' → '),
      status,
      scopeCount: item.scopeCount,
      redemptionCount: item.redemptionCount,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.promotions.title}
        description={t.promotions.resultCount.replace('{count}', String(result.total))}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[{ label: t.promotions.title }]}
          />
        }
        actions={
          <Button asChild>
            <Link href="/admin/promotions/new">
              <Plus className="size-4" aria-hidden="true" />
              {t.promotions.newPromotion}
            </Link>
          </Button>
        }
      />

      <QueryToolbar
        searchKey="q"
        searchPlaceholder={t.promotions.searchPlaceholder}
        labels={{
          allOption: t.promotions.allOption,
          clearAll: t.products.clearAll,
          removeFilter: t.products.removeFilter,
        }}
        selects={[
          {
            key: 'status',
            label: t.promotions.filterStatus,
            options: [
              { value: 'active', label: t.promotions.statusActive },
              { value: 'inactive', label: t.promotions.statusInactive },
              { value: 'scheduled', label: t.promotions.statusScheduled },
              { value: 'expired', label: t.promotions.statusExpired },
            ],
          },
          {
            key: 'type',
            label: t.promotions.filterType,
            options: [
              { value: 'PERCENTAGE', label: t.promotions.typePercentage },
              { value: 'FIXED', label: t.promotions.typeFixed },
            ],
          },
          {
            key: 'sort',
            label: t.promotions.sort,
            includeAll: false,
            options: [
              { value: 'created-desc', label: t.promotions.sortCreatedDesc },
              { value: 'created-asc', label: t.promotions.sortCreatedAsc },
              { value: 'code-asc', label: t.promotions.sortCodeAsc },
              { value: 'ends-asc', label: t.promotions.sortEndsAsc },
            ],
          },
        ]}
      />

      <PromotionsTable
        rows={rows}
        page={result.page}
        pageCount={result.pageCount}
        locale={locale}
        labels={{
          colCode: t.promotions.colCode,
          colType: t.promotions.colType,
          colValue: t.promotions.colValue,
          colUsage: t.promotions.colUsage,
          colWindow: t.promotions.colWindow,
          colStatus: t.promotions.colStatus,
          actions: t.common.actions,
          emptyTitle: t.promotions.emptyTitle,
          emptyDescription: t.promotions.emptyDescription,
          typePercentage: t.promotions.typePercentage,
          typeFixed: t.promotions.typeFixed,
          statusActive: t.promotions.statusActive,
          statusInactive: t.promotions.statusInactive,
          statusScheduled: t.promotions.statusScheduled,
          statusExpired: t.promotions.statusExpired,
          activate: t.promotions.activate,
          deactivate: t.promotions.deactivate,
          activated: t.promotions.activated,
          deactivated: t.promotions.deactivated,
          deleted: t.promotions.deleted,
          delete: t.common.delete,
          confirmDeleteTitle: t.common.confirmDeleteTitle,
          deleteConfirmDescription: t.promotions.deleteConfirmDescription,
          cancel: t.common.cancel,
          confirm: t.common.confirm,
          previousPage: t.products.previousPage,
          nextPage: t.products.nextPage,
          pageLabel: t.products.pageLabel,
        }}
      />
    </div>
  );
}
