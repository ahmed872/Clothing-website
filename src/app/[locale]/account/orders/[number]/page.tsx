import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { isLocale, type Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { resolveOrderAccess } from '@/lib/orders/order-identity';
import { OrderDetail, formatOrderDate } from '@/components/storefront/orders/order-detail';
import { StorefrontBreadcrumbs } from '@/components/storefront/listing/storefront-breadcrumbs';
import { Button } from '@/components/ui/button';

/**
 * One order, for the person who placed it.
 *
 * Access goes through the same resolver the success page uses, so a customer
 * reaching another customer's order number gets a 404 here too — the
 * authorisation lives in one place rather than being re-derived per route.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; number: string }>;
}): Promise<Metadata> {
  const { locale: raw, number } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  return {
    title: `${getDictionary(locale).orders.orderNumber} ${number}`,
    robots: { index: false, follow: false },
  };
}

export default async function AccountOrderPage({
  params,
}: {
  params: Promise<{ locale: string; number: string }>;
}) {
  const { locale: raw, number } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  const t = getDictionary(locale).orders;

  const access = await resolveOrderAccess(number);
  if (!access) notFound();

  const { order } = access;

  return (
    <div className="container mx-auto flex flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <StorefrontBreadcrumbs
        locale={locale}
        trail={[{ label: t.myOrders, href: `/${locale}/account/orders` }, { label: order.number }]}
      />

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-mono text-h4 text-(--color-text)" dir="ltr">
            {order.number}
          </h1>
          <p className="text-small text-(--color-text-muted)">
            {formatOrderDate(order.placedAt, locale)}
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/${locale}/account/orders`}>{t.backToOrders}</Link>
        </Button>
      </div>

      <OrderDetail order={order} locale={locale} />
    </div>
  );
}
