import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { BadgePercent, Package, ShoppingCart, TrendingUp, UserPlus, Wallet } from 'lucide-react';

import { formatMoney } from '@/modules/core';
import { percentageChange } from '@/modules/analytics';
import { getStoreSettings } from '@/modules/settings';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { orderStatusLabel } from '@/lib/orders/order-labels';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { formatAdminDate } from '@/lib/admin/format-admin-date';
import {
  DEFAULT_REPORT_RANGE_DAYS,
  REPORT_RANGE_DAYS,
  getSalesReportAction,
  parseReportRangeDays,
} from '@/lib/admin/analytics-actions';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { KpiCard } from '@/components/admin/kpi-card';
import { QueryToolbar } from '@/components/admin/query-toolbar';
import { RevenueChart, type RevenueChartDatum } from '@/components/admin/revenue-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Analytics' };

/**
 * The store's numbers (P15).
 *
 * Everything on this page is derived from orders, order items, customers
 * and coupon codes — data the platform genuinely records. There is no
 * "views" tile, because nothing writes `ProductView` (see
 * `analytics/report.service.ts`), and no refund-adjusted revenue, because
 * no refund *amount* is stored anywhere. The methodology note at the bottom
 * says both out loud rather than leaving a reader to assume a number means
 * more than it does.
 */
export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPermission('analytics.read');

  const params = await searchParams;
  const rawRange = Array.isArray(params.range) ? params.range[0] : params.range;
  const days = parseReportRangeDays(rawRange);

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  const [report, settings] = await Promise.all([
    getSalesReportAction(days),
    getStoreSettings(locale),
  ]);
  const money = (minor: number) => formatMoney(minor, { locale, currency: settings.currency });
  const number = (value: number) => new Intl.NumberFormat(`${locale}-u-nu-latn`).format(value);

  const rangeLabels: Record<number, string> = {
    7: t.analytics.range7,
    30: t.analytics.range30,
    90: t.analytics.range90,
    365: t.analytics.range365,
  };

  const chartData: RevenueChartDatum[] = report.revenueByDay.map((day) => ({
    date: day.date,
    // `day.date` is a UTC calendar day; parsing it back at midnight UTC
    // keeps the label on the same day the bucket is for.
    dateLabel: formatAdminDate(new Date(`${day.date}T00:00:00.000Z`), locale),
    revenueMinor: day.revenueMinor,
    amountLabel: money(day.revenueMinor),
    orderCount: day.orderCount,
  }));

  const totalStatusCount = report.ordersByStatus.reduce((sum, slice) => sum + slice.count, 0);

  // `?? undefined`, not `?? 0`: `percentageChange` returns null when the
  // previous period was empty, and KpiCard omits the delta entirely rather
  // than drawing a green "+0%" against no comparison at all.
  const delta = (current: number, previous: number) =>
    percentageChange(current, previous) ?? undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.analytics.title}
        description={t.analytics.description}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[{ label: t.analytics.title }]}
          />
        }
      />

      <QueryToolbar
        labels={{
          allOption: t.promotions.allOption,
          clearAll: t.products.clearAll,
          removeFilter: t.products.removeFilter,
        }}
        selects={[
          {
            key: 'range',
            label: t.analytics.rangeLabel,
            includeAll: false,
            // The same default the server falls back to when `?range=` is
            // absent, so the control never names a period the figures below
            // it were not built from.
            defaultValue: String(DEFAULT_REPORT_RANGE_DAYS),
            options: REPORT_RANGE_DAYS.map((value) => ({
              value: String(value),
              label: rangeLabels[value]!,
            })),
          },
        ]}
      />

      <p className="text-small text-(--color-text-muted)">
        {t.analytics.rangeSummary
          .replace('{from}', formatAdminDate(report.range.from, locale))
          .replace(
            '{to}',
            // `to` is exclusive (midnight after the last day), so the label
            // names the last day the report actually covers.
            formatAdminDate(new Date(report.range.to.getTime() - 1), locale),
          )}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          label={t.analytics.kpiRevenue}
          value={money(report.totals.paidRevenueMinor)}
          icon={Wallet}
          delta={delta(report.totals.paidRevenueMinor, report.previous.paidRevenueMinor)}
          deltaLabel={t.analytics.vsPrevious}
        />
        <KpiCard
          label={t.analytics.kpiOrders}
          value={number(report.totals.paidOrderCount)}
          icon={ShoppingCart}
          delta={delta(report.totals.paidOrderCount, report.previous.paidOrderCount)}
          deltaLabel={t.analytics.vsPrevious}
        />
        <KpiCard
          label={t.analytics.kpiAov}
          value={money(report.totals.averageOrderValueMinor)}
          icon={TrendingUp}
          delta={delta(
            report.totals.averageOrderValueMinor,
            report.previous.averageOrderValueMinor,
          )}
          deltaLabel={t.analytics.vsPrevious}
        />
        <KpiCard
          label={t.analytics.kpiUnits}
          value={number(report.totals.unitsSold)}
          icon={Package}
          delta={delta(report.totals.unitsSold, report.previous.unitsSold)}
          deltaLabel={t.analytics.vsPrevious}
        />
        <KpiCard
          label={t.analytics.kpiNewCustomers}
          value={number(report.totals.newCustomerCount)}
          icon={UserPlus}
          delta={delta(report.totals.newCustomerCount, report.previous.newCustomerCount)}
          deltaLabel={t.analytics.vsPrevious}
        />
        <KpiCard
          label={t.analytics.kpiPlacedOrders}
          value={number(report.totals.placedOrderCount)}
          icon={BadgePercent}
          delta={delta(report.totals.placedOrderCount, report.previous.placedOrderCount)}
          deltaLabel={t.analytics.vsPrevious}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t.analytics.revenueChartTitle}</CardTitle>
          <p className="text-small text-(--color-text-muted)">
            {t.analytics.revenueChartDescription}
          </p>
        </CardHeader>
        <CardContent>
          <RevenueChart
            data={chartData}
            labels={{
              caption: t.analytics.revenueChartTitle,
              colDate: t.analytics.rangeLabel,
              colAmount: t.analytics.colRevenue,
              colOrders: t.analytics.colCount,
              empty: t.analytics.revenueChartEmpty,
            }}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2">{t.analytics.topProductsTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            {report.topProducts.length === 0 ? (
              <p className="text-small text-(--color-text-muted)">{t.analytics.topProductsEmpty}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.analytics.colProduct}</TableHead>
                    <TableHead>{t.analytics.colUnits}</TableHead>
                    <TableHead>{t.analytics.colRevenue}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.topProducts.map((product) => (
                    <TableRow key={product.productId ?? 'deleted'}>
                      <TableCell>
                        {(locale === 'ar' ? product.nameAr : product.nameEn) ||
                          t.analytics.deletedProduct}
                      </TableCell>
                      <TableCell className="tabular-nums">{number(product.unitsSold)}</TableCell>
                      <TableCell className="tabular-nums">{money(product.revenueMinor)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">{t.analytics.statusTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            {report.ordersByStatus.length === 0 ? (
              <p className="text-small text-(--color-text-muted)">{t.analytics.statusEmpty}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.analytics.colOrderStatus}</TableHead>
                    <TableHead>{t.analytics.colCount}</TableHead>
                    <TableHead>{t.analytics.colShare}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.ordersByStatus.map((slice) => (
                    <TableRow key={slice.status}>
                      <TableCell>{orderStatusLabel(slice.status, locale)}</TableCell>
                      <TableCell className="tabular-nums">{number(slice.count)}</TableCell>
                      <TableCell className="tabular-nums" dir="ltr">
                        {Math.round((slice.count / totalStatusCount) * 100)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">{t.analytics.couponsTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            {report.coupons.length === 0 ? (
              <p className="text-small text-(--color-text-muted)">{t.analytics.couponsEmpty}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.analytics.colCoupon}</TableHead>
                    <TableHead>{t.analytics.colRedemptions}</TableHead>
                    <TableHead>{t.analytics.colDiscount}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.coupons.map((coupon) => (
                    <TableRow key={coupon.code}>
                      <TableCell dir="ltr">{coupon.code}</TableCell>
                      <TableCell className="tabular-nums">{number(coupon.redemptions)}</TableCell>
                      <TableCell className="tabular-nums">{money(coupon.discountMinor)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">{t.analytics.refundsTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            {report.refundedOrderCount === 0 && report.partiallyRefundedOrderCount === 0 ? (
              <p className="text-small text-(--color-text-muted)">{t.analytics.noRefunds}</p>
            ) : (
              <dl className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-small text-(--color-text-muted)">
                    {t.analytics.refundedOrders}
                  </dt>
                  <dd className="tabular-nums text-h6 text-(--color-text)">
                    {number(report.refundedOrderCount)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-small text-(--color-text-muted)">
                    {t.analytics.partiallyRefundedOrders}
                  </dt>
                  <dd className="tabular-nums text-h6 text-(--color-text)">
                    {number(report.partiallyRefundedOrderCount)}
                  </dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>
      </div>

      <section
        aria-labelledby="analytics-methodology"
        className="flex flex-col gap-2 rounded-(--radius-container) border border-(--color-border) bg-(--color-muted) p-4"
      >
        <h2 id="analytics-methodology" className="text-label text-(--color-text)">
          {t.analytics.methodologyTitle}
        </h2>
        <p className="text-small text-(--color-text-muted)">{t.analytics.methodologyRevenue}</p>
        <p className="text-small text-(--color-text-muted)">{t.analytics.methodologyRefunds}</p>
        <p className="text-small text-(--color-text-muted)">{t.analytics.methodologyViews}</p>
      </section>
    </div>
  );
}
