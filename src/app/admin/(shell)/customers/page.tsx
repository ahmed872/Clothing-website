import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { formatMoney } from '@/modules/core';
import { getStoreSettings } from '@/modules/settings';
import type { CustomerSort } from '@/modules/customers';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { formatAdminDate } from '@/lib/admin/format-admin-date';
import { listCustomerDirectory } from '@/lib/admin/customer-directory';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { QueryToolbar } from '@/components/admin/query-toolbar';
import { CustomersTable, type CustomerRow } from '@/components/admin/customers-table';

export const metadata: Metadata = { title: 'Customers' };

const SORTS: CustomerSort[] = ['created_desc', 'created_asc', 'name_asc'];

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPermission('customers.read');

  const params = await searchParams;
  const one = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  const verifiedParam = one('verified');
  const [result, settings] = await Promise.all([
    listCustomerDirectory({
      q: one('q') || undefined,
      verified:
        verifiedParam === 'verified' || verifiedParam === 'unverified' ? verifiedParam : undefined,
      sort: SORTS.find((sort) => sort === one('sort')) ?? 'created_desc',
      page: parsePositiveInt(one('page')) ?? 1,
    }),
    getStoreSettings(locale),
  ]);

  const rows: CustomerRow[] = result.items.map((item) => ({
    id: item.id,
    name: item.name,
    email: item.email,
    phone: item.phone,
    verified: item.emailVerifiedAt !== null,
    active: item.active,
    orderCount: item.orderCount,
    spentLabel: formatMoney(item.paidTotalMinor, { locale, currency: settings.currency }),
    lastOrderLabel: item.lastOrderAt ? formatAdminDate(item.lastOrderAt, locale) : null,
    joinedLabel: formatAdminDate(item.createdAt, locale),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.customers.title}
        description={t.customers.resultCount.replace('{count}', String(result.total))}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[{ label: t.customers.title }]}
          />
        }
      />

      <QueryToolbar
        searchKey="q"
        searchPlaceholder={t.customers.searchPlaceholder}
        labels={{
          allOption: t.promotions.allOption,
          clearAll: t.products.clearAll,
          removeFilter: t.products.removeFilter,
        }}
        selects={[
          {
            key: 'verified',
            label: t.customers.filterVerified,
            options: [
              { value: 'verified', label: t.customers.verified },
              { value: 'unverified', label: t.customers.unverified },
            ],
          },
          {
            key: 'sort',
            label: t.customers.sort,
            includeAll: false,
            options: [
              { value: 'created_desc', label: t.customers.sortCreatedDesc },
              { value: 'created_asc', label: t.customers.sortCreatedAsc },
              { value: 'name_asc', label: t.customers.sortNameAsc },
            ],
          },
        ]}
      />

      <CustomersTable
        rows={rows}
        page={result.page}
        pageCount={result.pageCount}
        locale={locale}
        labels={{
          colCustomer: t.customers.colCustomer,
          colPhone: t.customers.colPhone,
          colOrders: t.customers.colOrders,
          colSpent: t.customers.colSpent,
          colLastOrder: t.customers.colLastOrder,
          colJoined: t.customers.colJoined,
          colStatus: t.customers.colStatus,
          emptyTitle: t.customers.emptyTitle,
          emptyDescription: t.customers.emptyDescription,
          verified: t.customers.verified,
          unverified: t.customers.unverified,
          accountActive: t.customers.accountActive,
          accountDisabled: t.customers.accountDisabled,
          never: t.customers.never,
          previousPage: t.products.previousPage,
          nextPage: t.products.nextPage,
          pageLabel: t.products.pageLabel,
        }}
      />
    </div>
  );
}
