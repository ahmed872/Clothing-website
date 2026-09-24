import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { ArrowLeft } from 'lucide-react';

import { listAdjustments, MANUAL_INVENTORY_REASONS } from '@/modules/inventory';
import { listStaffUsers } from '@/modules/identity';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { formatAdminDate } from '@/lib/admin/format-admin-date';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { QueryToolbar } from '@/components/admin/query-toolbar';
import {
  InventoryHistoryTable,
  type InventoryHistoryRow,
} from '@/components/admin/inventory-history-table';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Inventory history' };

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** A date from the URL is user input: an unparseable one is dropped rather
 * than turned into an `Invalid Date` the query would choke on. `to` covers
 * the whole day the admin picked — a filter that silently excluded
 * everything after midnight would look like missing history. */
function parseDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export default async function AdminInventoryHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPermission('inventory.read');

  const params = await searchParams;
  const one = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  const reasonParam = one('reason');
  const [result, staff] = await Promise.all([
    listAdjustments({
      productId: one('productId') || undefined,
      variantId: one('variantId') || undefined,
      reason: MANUAL_INVENTORY_REASONS.find((reason) => reason === reasonParam),
      actorUserId: one('actorUserId') || undefined,
      from: parseDate(one('from')),
      to: parseDate(one('to'), true),
      page: parsePositiveInt(one('page')) ?? 1,
    }),
    listStaffUsers(),
  ]);

  const reasonLabel: Record<string, string> = {
    RESTOCK: t.inventory.reasonRESTOCK,
    RETURN: t.inventory.reasonRETURN,
    DAMAGED: t.inventory.reasonDAMAGED,
    CORRECTION: t.inventory.reasonCORRECTION,
    MANUAL: t.inventory.reasonMANUAL,
    SALE: t.inventory.reasonMANUAL,
    CANCELLATION: t.inventory.reasonMANUAL,
  };

  const rows: InventoryHistoryRow[] = result.items.map((item) => ({
    id: item.id,
    when: formatAdminDate(item.createdAt, locale),
    delta: item.delta,
    previousQuantity: item.previousQuantity,
    newQuantity: item.newQuantity,
    reason: reasonLabel[item.reason] ?? item.reason,
    note: item.note,
    // An adjustment with no actor is one the system made (an order, a
    // cancellation) — named as such rather than left blank, since a blank
    // cell reads as missing data.
    actor: item.actor ? (item.actor.name ?? item.actor.email) : t.inventory.systemActor,
    sku: item.variant.sku,
    productId: item.product.id,
    productName: locale === 'ar' ? item.product.nameAr : item.product.nameEn,
    variantLabel:
      (locale === 'ar' ? item.variant.labelAr : item.variant.labelEn) || item.variant.sku,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.inventory.historyTitle}
        description={t.inventory.historyCount.replace('{count}', String(result.total))}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[
              { label: t.inventory.title, href: '/admin/inventory' },
              { label: t.inventory.history },
            ]}
          />
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/admin/inventory">
              <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
              {t.inventory.backToInventory}
            </Link>
          </Button>
        }
      />

      <QueryToolbar
        labels={{
          allOption: t.inventory.allOption,
          clearAll: t.products.clearAll,
          removeFilter: t.products.removeFilter,
        }}
        selects={[
          {
            key: 'reason',
            label: t.inventory.filterReason,
            options: MANUAL_INVENTORY_REASONS.map((reason) => ({
              value: reason,
              label: reasonLabel[reason] ?? reason,
            })),
          },
          {
            key: 'actorUserId',
            label: t.inventory.filterActor,
            options: staff.map((member) => ({
              value: member.id,
              label: member.name ?? member.email,
            })),
          },
        ]}
        dates={[
          { key: 'from', label: t.inventory.filterFrom },
          { key: 'to', label: t.inventory.filterTo },
        ]}
      />

      <InventoryHistoryTable
        rows={rows}
        page={result.page}
        pageCount={result.pageCount}
        labels={{
          colWhen: t.inventory.colWhen,
          colVariant: t.inventory.colVariant,
          colSku: t.inventory.colSku,
          colBefore: t.inventory.colBefore,
          colChange: t.inventory.colChange,
          colAfter: t.inventory.colAfter,
          colReason: t.inventory.colReason,
          colActor: t.inventory.colActor,
          colNote: t.inventory.colNote,
          emptyTitle: t.inventory.historyEmptyTitle,
          emptyDescription: t.inventory.historyEmptyDescription,
          previousPage: t.inventory.previousPage,
          nextPage: t.inventory.nextPage,
          pageLabel: t.inventory.pageLabel,
        }}
      />
    </div>
  );
}
