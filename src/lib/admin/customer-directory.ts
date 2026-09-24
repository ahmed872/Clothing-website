import 'server-only';

import {
  getCustomerForAdmin,
  listCustomersForAdmin,
  type CustomerDetail,
  type CustomerListItem,
  type CustomerListQuery,
} from '@/modules/customers';
import { getOrderStatsForCustomers, type CustomerOrderStats } from '@/modules/orders';

/**
 * "Who are our customers, and what have they bought" — composed here
 * because neither module may answer it alone (P15).
 *
 * `customers` may depend on core/identity/catalog; `orders` is not on that
 * list, and it should not be — a customer record has no business knowing
 * the order domain exists. But an admin directory that cannot say "12
 * orders, 4,300 SAR" is not a directory anyone would use. So each module
 * answers its own half and this file, which sits above both, joins them:
 * exactly the pattern `customer-identity.ts` (P12) and
 * `email-dispatcher.ts` (P13) already use for the same structural reason.
 *
 * The join is by id over one page of rows, never per-row: a page of twenty
 * customers costs two grouped queries, not twenty.
 */

export interface CustomerDirectoryRow extends CustomerListItem, OrderTotals {}

export interface CustomerDirectoryPage {
  items: CustomerDirectoryRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** A customer with no orders is absent from the grouped result, not present
 * with a zero — so "no row" and "no orders" mean the same thing here. */
interface OrderTotals {
  orderCount: number;
  paidTotalMinor: number;
  lastOrderAt: Date | null;
}

function merge<T extends CustomerListItem>(
  customer: T,
  stats: CustomerOrderStats | undefined,
): T & OrderTotals {
  return {
    ...customer,
    orderCount: stats?.orderCount ?? 0,
    paidTotalMinor: stats?.paidTotalMinor ?? 0,
    lastOrderAt: stats?.lastOrderAt ?? null,
  };
}

export async function listCustomerDirectory(
  query: CustomerListQuery = {},
): Promise<CustomerDirectoryPage> {
  const page = await listCustomersForAdmin(query);
  const stats = await getOrderStatsForCustomers(page.items.map((item) => item.id));

  return {
    ...page,
    items: page.items.map((item) => merge(item, stats.get(item.id))),
  };
}

export type CustomerDirectoryDetail = CustomerDetail & OrderTotals;

export async function getCustomerDirectoryDetail(
  id: string,
): Promise<CustomerDirectoryDetail | null> {
  const customer = await getCustomerForAdmin(id);
  if (!customer) return null;

  const stats = await getOrderStatsForCustomers([customer.id]);
  return merge(customer, stats.get(customer.id));
}
