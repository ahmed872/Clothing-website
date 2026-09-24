import type { Metadata } from 'next';
import Link from 'next/link';

import { requireCustomerAccount } from '@/lib/customers/customer-identity';
import { listCustomerOrders } from '@/modules/orders';
import { formatMoney } from '@/modules/core';
import { isLocale, type Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { OrderStatusBadge } from '@/components/storefront/orders/order-status-badges';
import { formatOrderDate } from '@/components/storefront/orders/order-detail';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';

/**
 * A customer's own orders — paginated (P12 §19: never an unbounded
 * historical fetch), scoped by the session-derived customer id from
 * `requireCustomerAccount()`, never an id the client supplies. The
 * surrounding `(protected)/layout.tsx` already gates sign-in; this file
 * used to carry its own inline `getOptionalUser`/redirect check, which is
 * now the layout's job instead of being duplicated on every page under it.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  return { title: getDictionary(locale).orders.myOrders, robots: { index: false, follow: false } };
}

export default async function AccountOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  const t = getDictionary(locale).orders;

  const account = await requireCustomerAccount();

  const query = await searchParams;
  const pageParam = Array.isArray(query.page) ? query.page[0] : query.page;
  const page = Number.parseInt(pageParam ?? '1', 10);

  const orders = await listCustomerOrders(account.customerId, {
    page: Number.isFinite(page) && page > 0 ? page : 1,
  });

  return (
    <div className="flex flex-col gap-6">
      {orders.items.length === 0 ? (
        <EmptyState
          title={t.noOrders}
          description={t.noOrdersBody}
          action={
            <Button asChild>
              <Link href={`/${locale}`}>{getDictionary(locale).cart.continueShopping}</Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.items.map((order) => (
            <li key={order.number}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <Link
                      href={`/${locale}/account/orders/${order.number}`}
                      className="font-mono text-small text-(--color-text) underline-offset-4 hover:underline"
                      dir="ltr"
                    >
                      {order.number}
                    </Link>
                    <span className="text-caption text-(--color-text-muted)">
                      {formatOrderDate(order.placedAt, locale)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-4">
                    <span className="text-caption text-(--color-text-muted)">
                      {t.itemsCount.replace('{count}', String(order.itemCount))}
                    </span>
                    <OrderStatusBadge status={order.status} locale={locale} />
                    <span className="text-small font-semibold tabular-nums text-(--color-text)">
                      {formatMoney(order.totalMinor, { currency: order.currency, locale })}
                    </span>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/${locale}/account/orders/${order.number}`}>{t.view}</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {orders.pageCount > 1 ? (
        <nav className="flex items-center justify-center gap-2" aria-label={t.myOrders}>
          {Array.from({ length: orders.pageCount }, (_, index) => index + 1).map((number) => (
            <Button
              key={number}
              asChild
              size="sm"
              variant={number === orders.page ? 'primary' : 'ghost'}
            >
              <Link
                href={`/${locale}/account/orders?page=${number}`}
                aria-current={number === orders.page ? 'page' : undefined}
              >
                {number}
              </Link>
            </Button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
