'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { DataTable, type DataTableColumn } from '@/components/admin/data-table';
import { StatusBadge } from '@/components/admin/status-badge';
import { Pagination } from '@/components/ui/pagination';
import type { Locale } from '@/lib/i18n/locales';

export interface CustomerRow {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  verified: boolean;
  active: boolean;
  orderCount: number;
  /** Pre-formatted server-side: money needs the store's currency, and dates
   * need the admin calendar rules `format-admin-date.ts` owns. */
  spentLabel: string;
  lastOrderLabel: string | null;
  joinedLabel: string;
}

export interface CustomersTableLabels {
  colCustomer: string;
  colPhone: string;
  colOrders: string;
  colSpent: string;
  colLastOrder: string;
  colJoined: string;
  colStatus: string;
  emptyTitle: string;
  emptyDescription: string;
  verified: string;
  unverified: string;
  accountActive: string;
  accountDisabled: string;
  never: string;
  previousPage: string;
  nextPage: string;
  pageLabel: string;
}

/**
 * The customer directory (P15) — a list, and nothing that acts on a row.
 *
 * Every other admin table in this codebase carries an actions column; this
 * one deliberately does not. `customers.read` grants reading customers and
 * nothing else, and the writes an admin might reach for belong elsewhere by
 * design (see `customer-admin.service.ts`). A row links to its detail page
 * and stops there.
 */
export function CustomersTable({
  rows,
  page,
  pageCount,
  labels,
}: {
  rows: CustomerRow[];
  page: number;
  pageCount: number;
  locale: Locale;
  labels: CustomersTableLabels;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function goToPage(next: number): void {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(next));
    router.push(`${pathname}?${params.toString()}`);
  }

  const columns: DataTableColumn<CustomerRow>[] = [
    {
      key: 'customer',
      header: labels.colCustomer,
      cell: (row) => (
        <Link href={`/admin/customers/${row.id}`} className="flex flex-col hover:underline">
          <span className="font-medium text-(--color-text)">{row.name?.trim() || row.email}</span>
          {/* An email address is one LTR run in both languages. */}
          <span dir="ltr" className="text-caption text-(--color-text-muted)">
            {row.email}
          </span>
        </Link>
      ),
    },
    {
      key: 'phone',
      header: labels.colPhone,
      cell: (row) => (
        <span dir="ltr" className="text-(--color-text-muted) tabular-nums">
          {row.phone || labels.never}
        </span>
      ),
    },
    {
      key: 'orders',
      header: labels.colOrders,
      align: 'end',
      cell: (row) => <span className="tabular-nums">{row.orderCount}</span>,
    },
    {
      key: 'spent',
      header: labels.colSpent,
      align: 'end',
      cell: (row) => <span className="tabular-nums">{row.spentLabel}</span>,
    },
    {
      key: 'lastOrder',
      header: labels.colLastOrder,
      cell: (row) => (
        <span className="text-(--color-text-muted)">{row.lastOrderLabel ?? labels.never}</span>
      ),
    },
    {
      key: 'joined',
      header: labels.colJoined,
      cell: (row) => <span className="text-(--color-text-muted)">{row.joinedLabel}</span>,
    },
    {
      key: 'status',
      header: labels.colStatus,
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <StatusBadge
            label={row.verified ? labels.verified : labels.unverified}
            tone={row.verified ? 'success' : 'warning'}
          />
          {row.active ? null : <StatusBadge label={labels.accountDisabled} tone="error" />}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        emptyTitle={labels.emptyTitle}
        emptyDescription={labels.emptyDescription}
      />
      {pageCount > 1 ? (
        <Pagination
          page={page}
          pageCount={pageCount}
          onPageChange={goToPage}
          className="justify-end"
          labels={{
            previous: labels.previousPage,
            next: labels.nextPage,
            page: (n) => labels.pageLabel.replace('{n}', String(n)),
          }}
        />
      ) : null}
    </div>
  );
}
