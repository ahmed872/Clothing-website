import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import type { FulfillmentStatus, OrderStatus, PaymentStatus } from '@generated/prisma';

import { listOrdersForAdmin, type AdminOrderSort } from '@/modules/orders';
import { formatMoney } from '@/modules/core';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import {
  fulfillmentStatusLabel,
  orderStatusLabel,
  paymentStatusLabel,
} from '@/lib/orders/order-labels';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { formatAdminDate } from '@/lib/admin/format-admin-date';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { QueryToolbar } from '@/components/admin/query-toolbar';
import {
  FulfillmentStatusBadge,
  OrderStatusBadge,
  PaymentStatusBadge,
} from '@/components/storefront/orders/order-status-badges';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Orders' };

const ORDER_STATUSES: OrderStatus[] = [
  'PENDING_PAYMENT',
  'PENDING_MANUAL_CONFIRMATION',
  'CONFIRMED',
  'PROCESSING',
  'COMPLETED',
  'CANCELLED',
];
const PAYMENT_STATUSES: PaymentStatus[] = [
  'UNPAID',
  'PENDING',
  'PAID',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
];
const FULFILLMENT_STATUSES: FulfillmentStatus[] = [
  'UNFULFILLED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
];
const SORTS: AdminOrderSort[] = ['placed_desc', 'placed_asc', 'total_desc', 'total_asc'];

/** A date-only filter value is inclusive of the whole day it names, which is
 * what an operator means by "to 2 September" — not "up to midnight". */
function parseDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPermission('orders.read');

  const params = await searchParams;
  const one = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);
  const to = t.ordersAdmin;

  const pageParam = Number.parseInt(one('page') ?? '1', 10);

  const result = await listOrdersForAdmin({
    search: one('q') || undefined,
    status: ORDER_STATUSES.find((status) => status === one('status')),
    paymentStatus: PAYMENT_STATUSES.find((status) => status === one('payment')),
    fulfillmentStatus: FULFILLMENT_STATUSES.find((status) => status === one('fulfillment')),
    from: parseDate(one('from')),
    to: parseDate(one('to'), true),
    sort: SORTS.find((sort) => sort === one('sort')) ?? 'placed_desc',
    page: Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1,
  });

  const hasFilters = Boolean(
    one('q') || one('status') || one('payment') || one('fulfillment') || one('from') || one('to'),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={to.title}
        description={to.subtitle}
        breadcrumb={
          <AdminBreadcrumbs dashboardLabel={t.shell.dashboard} trail={[{ label: to.title }]} />
        }
      />

      <QueryToolbar
        searchKey="q"
        searchPlaceholder={to.searchPlaceholder}
        selects={[
          {
            key: 'status',
            label: to.filterStatus,
            includeAll: true,
            options: ORDER_STATUSES.map((status) => ({
              value: status,
              label: orderStatusLabel(status, locale),
            })),
          },
          {
            key: 'payment',
            label: to.filterPayment,
            includeAll: true,
            options: PAYMENT_STATUSES.map((status) => ({
              value: status,
              label: paymentStatusLabel(status, locale),
            })),
          },
          {
            key: 'fulfillment',
            label: to.filterFulfillment,
            includeAll: true,
            options: FULFILLMENT_STATUSES.map((status) => ({
              value: status,
              label: fulfillmentStatusLabel(status, locale),
            })),
          },
          {
            key: 'sort',
            label: to.sortLabel,
            options: [
              { value: 'placed_desc', label: to.sortPlacedDesc },
              { value: 'placed_asc', label: to.sortPlacedAsc },
              { value: 'total_desc', label: to.sortTotalDesc },
              { value: 'total_asc', label: to.sortTotalAsc },
            ],
          },
        ]}
        dates={[
          { key: 'from', label: to.filterFrom },
          { key: 'to', label: to.filterTo },
        ]}
        labels={{
          allOption: t.promotions.allOption,
          clearAll: t.products.clearAll,
          removeFilter: t.products.removeFilter,
        }}
      />

      {result.items.length === 0 ? (
        <EmptyState
          title={hasFilters ? to.emptyFiltered : to.empty}
          description={hasFilters ? to.emptyFilteredDescription : to.emptyDescription}
        />
      ) : (
        <div className="overflow-x-auto rounded-(--radius-surface) border border-(--color-border)">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{to.colNumber}</TableHead>
                <TableHead>{to.colDate}</TableHead>
                <TableHead>{to.colCustomer}</TableHead>
                <TableHead className="text-end">{to.colItems}</TableHead>
                <TableHead className="text-end">{to.colTotal}</TableHead>
                <TableHead>{to.colStatus}</TableHead>
                <TableHead>{to.colPayment}</TableHead>
                <TableHead>{to.colFulfillment}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <Link
                      href={`/admin/orders/${order.number}`}
                      className="font-mono text-small text-(--color-text) underline-offset-4 hover:underline"
                      dir="ltr"
                    >
                      {order.number}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-(--color-text-muted)">
                    {formatAdminDate(order.placedAt, locale)}
                  </TableCell>
                  <TableCell>
                    <span className="block text-(--color-text)">
                      {order.contactName ?? to.guest}
                    </span>
                    {order.customerEmail ? (
                      <span className="block text-caption text-(--color-text-muted)" dir="ltr">
                        {order.customerEmail}
                      </span>
                    ) : null}
                    {order.isGuestOrder ? (
                      <span className="text-caption text-(--color-text-subtle)">{to.guest}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{order.itemCount}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatMoney(order.totalMinor, { currency: order.currency, locale })}
                  </TableCell>
                  <TableCell>
                    <OrderStatusBadge status={order.status} locale={locale} />
                  </TableCell>
                  <TableCell>
                    <PaymentStatusBadge status={order.paymentStatus} locale={locale} />
                  </TableCell>
                  <TableCell>
                    <FulfillmentStatusBadge status={order.fulfillmentStatus} locale={locale} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {result.pageCount > 1 ? (
        <nav className="flex items-center justify-center gap-2" aria-label={to.title}>
          {Array.from({ length: result.pageCount }, (_, index) => index + 1).map((number) => {
            const next = new URLSearchParams();
            for (const [key, value] of Object.entries(params)) {
              const single = Array.isArray(value) ? value[0] : value;
              if (single && key !== 'page') next.set(key, single);
            }
            next.set('page', String(number));
            return (
              <Button
                key={number}
                asChild
                size="sm"
                variant={number === result.page ? 'primary' : 'ghost'}
              >
                <Link
                  href={`/admin/orders?${next.toString()}`}
                  aria-current={number === result.page ? 'page' : undefined}
                >
                  {number}
                </Link>
              </Button>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
