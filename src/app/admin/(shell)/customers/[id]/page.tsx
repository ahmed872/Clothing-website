import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';

import { formatMoney } from '@/modules/core';
import { getStoreSettings } from '@/modules/settings';
import { listCustomerOrders } from '@/modules/orders';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { formatAdminDate } from '@/lib/admin/format-admin-date';
import { getCustomerDirectoryDetail } from '@/lib/admin/customer-directory';
import { orderStatusLabel, orderStatusTone } from '@/lib/orders/order-labels';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { StatusBadge } from '@/components/admin/status-badge';
import { KpiCard } from '@/components/admin/kpi-card';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Customer' };

/** The customer's most recent orders. Not the whole history: this is a
 * summary panel, and the Orders screen already owns filtering and paging
 * over every order in the store. */
const RECENT_ORDERS = 10;

export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPermission('customers.read');

  const { id } = await params;
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  const customer = await getCustomerDirectoryDetail(id);
  if (!customer) notFound();

  const [settings, orders] = await Promise.all([
    getStoreSettings(locale),
    listCustomerOrders(customer.id, { pageSize: RECENT_ORDERS }),
  ]);

  const displayName = customer.name?.trim() || customer.email;
  const money = (minor: number) => formatMoney(minor, { locale, currency: settings.currency });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={displayName}
        description={customer.email}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[{ label: t.customers.title, href: '/admin/customers' }, { label: displayName }]}
          />
        }
      />

      <Alert variant="info">{t.customers.readOnlyNotice}</Alert>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label={t.customers.colOrders} value={String(customer.orderCount)} />
        <KpiCard label={t.customers.colSpent} value={money(customer.paidTotalMinor)} />
        <KpiCard
          label={t.customers.colLastOrder}
          value={
            customer.lastOrderAt ? formatAdminDate(customer.lastOrderAt, locale) : t.customers.never
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.customers.profileTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex items-start justify-between gap-4">
                <dt className="text-(--color-text-muted)">{t.customers.email}</dt>
                <dd dir="ltr" className="text-(--color-text)">
                  {customer.email}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-(--color-text-muted)">{t.customers.phone}</dt>
                <dd dir="ltr" className="text-(--color-text) tabular-nums">
                  {customer.phone || t.customers.never}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-(--color-text-muted)">{t.customers.colStatus}</dt>
                <dd>
                  <StatusBadge
                    label={customer.emailVerifiedAt ? t.customers.verified : t.customers.unverified}
                    tone={customer.emailVerifiedAt ? 'success' : 'warning'}
                  />
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-(--color-text-muted)">{t.customers.preferredLocale}</dt>
                <dd className="text-(--color-text)">
                  {customer.locale === 'AR' ? t.settings.localeAr : t.settings.localeEn}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-(--color-text-muted)">{t.customers.joined}</dt>
                <dd className="text-(--color-text)">
                  {formatAdminDate(customer.createdAt, locale)}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-(--color-text-muted)">{t.customers.lastLogin}</dt>
                <dd className="text-(--color-text)">
                  {customer.lastLoginAt
                    ? formatAdminDate(customer.lastLoginAt, locale)
                    : t.customers.neverSignedIn}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.customers.addressesTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            {customer.addresses.length === 0 ? (
              <p className="text-small text-(--color-text-muted)">{t.customers.noAddresses}</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {customer.addresses.map((address) => (
                  <li
                    key={address.id}
                    className="rounded-(--radius-control) border border-(--color-border) p-3"
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="font-medium text-(--color-text)">{address.fullName}</span>
                      <StatusBadge
                        label={
                          address.type === 'BILLING'
                            ? t.customers.addressBilling
                            : t.customers.addressShipping
                        }
                        tone="neutral"
                      />
                      {address.isDefault ? (
                        <StatusBadge label={t.customers.addressDefault} tone="info" />
                      ) : null}
                    </div>
                    <p className="text-small text-(--color-text-muted)">
                      {[address.line1, address.line2, address.district, address.city]
                        .filter(Boolean)
                        .join('، ')}
                    </p>
                    <p dir="ltr" className="text-caption text-(--color-text-subtle) tabular-nums">
                      {address.phone}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.customers.ordersTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {orders.items.length === 0 ? (
            <p className="text-small text-(--color-text-muted)">{t.customers.noCustomerOrders}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-(--color-border)">
              {orders.items.map((order) => (
                <li key={order.number} className="flex flex-wrap items-center gap-3 py-3">
                  <Link
                    href={`/admin/orders/${order.number}`}
                    dir="ltr"
                    className="font-medium text-(--color-text) tabular-nums hover:underline"
                  >
                    {order.number}
                  </Link>
                  <StatusBadge
                    label={orderStatusLabel(order.status, locale)}
                    tone={orderStatusTone(order.status)}
                  />
                  <span className="text-(--color-text-muted)">
                    {formatAdminDate(order.placedAt, locale)}
                  </span>
                  <span className="ms-auto tabular-nums">{money(order.totalMinor)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
