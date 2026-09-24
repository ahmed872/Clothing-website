import 'server-only';

import type {
  FulfillmentStatus,
  OrderEventType,
  OrderStatus,
  PaymentStatus,
  Prisma,
} from '@generated/prisma';

import { db } from '@/modules/core';

import { hashOrderAccessToken, isOrderNumberShape } from './order-identifiers';
import type { ShippingAddress } from './checkout-schemas';

/**
 * Reading orders.
 *
 * Every function here takes the identity of the reader as an argument, and
 * the scope is expressed in the SQL `where` rather than checked after the
 * fact. That is the difference between "we filter what we show" and "we only
 * ever load what you may see" — the second cannot leak through a forgotten
 * branch (P10 §31).
 */

export interface OrderItemView {
  id: string;
  productNameAr: string;
  productNameEn: string;
  variantLabelAr: string | null;
  variantLabelEn: string | null;
  sku: string;
  quantity: number;
  unitPriceMinor: number;
  lineSubtotalMinor: number;
  lineDiscountMinor: number;
  lineTotalMinor: number;
  currency: string;
  /** Present only while the product still exists — used for "buy it again",
   * never for rendering the historical line, which uses the snapshots. */
  productId: string | null;
  variantId: string | null;
}

export interface OrderTimelineEntry {
  id: string;
  type: OrderEventType;
  fromValue: string | null;
  toValue: string | null;
  note: string | null;
  createdAt: Date;
  actor: { id: string; name: string | null; email: string } | null;
}

export interface OrderView {
  id: string;
  number: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
  couponCode: string | null;
  contactName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  shippingAddress: ShippingAddress | null;
  note: string | null;
  placedAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  isGuestOrder: boolean;
  items: OrderItemView[];
  itemCount: number;
}

export interface AdminOrderView extends OrderView {
  customer: { id: string; email: string; name: string | null } | null;
  timeline: OrderTimelineEntry[];
}

const ORDER_DETAIL_INCLUDE = {
  items: { orderBy: { skuSnapshot: 'asc' } },
} satisfies Prisma.OrderInclude;

type OrderWithItems = Prisma.OrderGetPayload<{ include: typeof ORDER_DETAIL_INCLUDE }>;

function toOrderView(order: OrderWithItems): OrderView {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    subtotalMinor: order.subtotalMinor,
    discountMinor: order.discountMinor,
    shippingMinor: order.shippingMinor,
    taxMinor: order.taxMinor,
    totalMinor: order.totalMinor,
    currency: order.currency,
    couponCode: order.couponCode,
    contactName: order.contactName,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    shippingAddress: (order.shippingAddress as ShippingAddress | null) ?? null,
    note: order.note,
    placedAt: order.placedAt,
    confirmedAt: order.confirmedAt,
    cancelledAt: order.cancelledAt,
    cancellationReason: order.cancellationReason,
    isGuestOrder: order.customerId === null,
    items: order.items.map((item) => ({
      id: item.id,
      productNameAr: item.productNameArSnapshot,
      productNameEn: item.productNameEnSnapshot,
      variantLabelAr: item.variantLabelArSnapshot,
      variantLabelEn: item.variantLabelEnSnapshot,
      sku: item.skuSnapshot,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      lineSubtotalMinor: item.lineSubtotalMinor,
      lineDiscountMinor: item.lineDiscountMinor,
      lineTotalMinor: item.lineTotalMinor,
      currency: item.currency,
      productId: item.productId,
      variantId: item.variantId,
    })),
    itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
  };
}

/**
 * A signed-in customer's own order.
 *
 * `customerId` is part of the query, not a check afterwards: substituting
 * someone else's order number returns null here, the same as a number that
 * does not exist, so the response cannot be used to probe which orders are
 * real (P10 §15).
 */
export async function getOrderForCustomer(
  number: string,
  customerId: string,
): Promise<OrderView | null> {
  if (!isOrderNumberShape(number)) return null;
  const order = await db.order.findFirst({
    where: { number, customerId },
    include: ORDER_DETAIL_INCLUDE,
  });
  return order ? toOrderView(order) : null;
}

/**
 * A guest's own order, opened with the token they were given at checkout.
 *
 * Both the number and the token hash have to match, and the token is the part
 * that carries the entropy — an order number alone opens nothing (P10 §14).
 * The lookup goes through the unique index on the hash, so the comparison
 * happens in the database rather than in a loop over candidates.
 */
export async function getOrderByAccessToken(
  number: string,
  token: string,
): Promise<OrderView | null> {
  if (!isOrderNumberShape(number) || token.length === 0) return null;
  const order = await db.order.findFirst({
    where: { number, accessTokenHash: hashOrderAccessToken(token) },
    include: ORDER_DETAIL_INCLUDE,
  });
  return order ? toOrderView(order) : null;
}

export interface CustomerOrderListItem {
  number: string;
  placedAt: Date;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  totalMinor: number;
  currency: string;
  itemCount: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function paginationOf(query: { page?: number; pageSize?: number }) {
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(query.pageSize ?? DEFAULT_PAGE_SIZE)),
  );
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export async function listCustomerOrders(
  customerId: string,
  query: { page?: number; pageSize?: number } = {},
): Promise<Paginated<CustomerOrderListItem>> {
  const { page, pageSize, skip, take } = paginationOf(query);

  const [rows, total] = await Promise.all([
    db.order.findMany({
      where: { customerId },
      orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
      select: {
        number: true,
        placedAt: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        totalMinor: true,
        currency: true,
        // Aggregated in SQL rather than by loading every line of every order.
        items: { select: { quantity: true } },
      },
    }),
    db.order.count({ where: { customerId } }),
  ]);

  return {
    items: rows.map((row) => ({
      number: row.number,
      placedAt: row.placedAt,
      status: row.status,
      paymentStatus: row.paymentStatus,
      fulfillmentStatus: row.fulfillmentStatus,
      totalMinor: row.totalMinor,
      currency: row.currency,
      itemCount: row.items.reduce((sum, item) => sum + item.quantity, 0),
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export type AdminOrderSort = 'placed_desc' | 'placed_asc' | 'total_desc' | 'total_asc';

export interface AdminOrderQuery {
  /** Matches an order number, or a customer's email/name/phone. */
  search?: string;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  fulfillmentStatus?: FulfillmentStatus;
  from?: Date;
  to?: Date;
  sort?: AdminOrderSort;
  page?: number;
  pageSize?: number;
}

export interface AdminOrderListItem extends CustomerOrderListItem {
  id: string;
  contactName: string | null;
  customerEmail: string | null;
  isGuestOrder: boolean;
}

function adminOrderWhere(query: AdminOrderQuery): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};

  if (query.status) where.status = query.status;
  if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
  if (query.fulfillmentStatus) where.fulfillmentStatus = query.fulfillmentStatus;
  if (query.from || query.to) {
    where.placedAt = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
  }

  const search = query.search?.trim();
  if (search) {
    where.OR = [
      { number: { contains: search, mode: 'insensitive' } },
      { customerEmail: { contains: search, mode: 'insensitive' } },
      { contactName: { contains: search, mode: 'insensitive' } },
      { customerPhone: { contains: search } },
    ];
  }

  return where;
}

function adminOrderOrderBy(
  sort: AdminOrderSort = 'placed_desc',
): Prisma.OrderOrderByWithRelationInput[] {
  switch (sort) {
    case 'placed_asc':
      return [{ placedAt: 'asc' }, { id: 'asc' }];
    case 'total_desc':
      return [{ totalMinor: 'desc' }, { id: 'desc' }];
    case 'total_asc':
      return [{ totalMinor: 'asc' }, { id: 'asc' }];
    case 'placed_desc':
    default:
      return [{ placedAt: 'desc' }, { id: 'desc' }];
  }
}

/**
 * The admin list: filtered, sorted and paginated in SQL (P10 §16).
 *
 * Never `findMany()` without a `take` — an order table is the one that grows
 * without bound, and a store that succeeds is exactly the one where an
 * unbounded query stops working.
 */
export async function listOrdersForAdmin(
  query: AdminOrderQuery = {},
): Promise<Paginated<AdminOrderListItem>> {
  const { page, pageSize, skip, take } = paginationOf(query);
  const where = adminOrderWhere(query);

  const [rows, total] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: adminOrderOrderBy(query.sort),
      skip,
      take,
      select: {
        id: true,
        number: true,
        placedAt: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        totalMinor: true,
        currency: true,
        contactName: true,
        customerEmail: true,
        customerId: true,
        items: { select: { quantity: true } },
      },
    }),
    db.order.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      number: row.number,
      placedAt: row.placedAt,
      status: row.status,
      paymentStatus: row.paymentStatus,
      fulfillmentStatus: row.fulfillmentStatus,
      totalMinor: row.totalMinor,
      currency: row.currency,
      contactName: row.contactName,
      customerEmail: row.customerEmail,
      isGuestOrder: row.customerId === null,
      itemCount: row.items.reduce((sum, item) => sum + item.quantity, 0),
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getOrderForAdmin(number: string): Promise<AdminOrderView | null> {
  if (!isOrderNumberShape(number)) return null;

  const order = await db.order.findUnique({
    where: { number },
    include: {
      ...ORDER_DETAIL_INCLUDE,
      customer: { select: { id: true, user: { select: { email: true, name: true } } } },
      events: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { actor: { select: { id: true, name: true, email: true } } },
      },
    },
  });
  if (!order) return null;

  return {
    ...toOrderView(order),
    customer: order.customer
      ? {
          id: order.customer.id,
          email: order.customer.user.email,
          name: order.customer.user.name,
        }
      : null,
    timeline: order.events.map((event) => ({
      id: event.id,
      type: event.type,
      fromValue: event.fromValue,
      toValue: event.toValue,
      note: event.note,
      createdAt: event.createdAt,
      actor: event.actor,
    })),
  };
}

/** Resolves a number to an id for the mutation actions, without exposing the
 * id anywhere a customer can see it. */
export async function getOrderIdByNumber(number: string): Promise<string | null> {
  if (!isOrderNumberShape(number)) return null;
  const order = await db.order.findUnique({ where: { number }, select: { id: true } });
  return order?.id ?? null;
}

// ---------------------------------------------------------------------------
// Per-customer roll-up (P15)
// ---------------------------------------------------------------------------

export interface CustomerOrderStats {
  customerId: string;
  orderCount: number;
  /** Money actually taken, in minor units — `PAID` orders only. An order
   * that is placed but unpaid, or cancelled, is not "what this customer has
   * spent", and adding it to a lifetime-value column is how that column
   * stops meaning anything. */
  paidTotalMinor: number;
  lastOrderAt: Date | null;
}

/**
 * Order counts and spend for a page of customers, in one query rather than
 * one per row.
 *
 * Lives in `orders` and not in `customers` because it reads the order
 * tables, and `customers` may not depend on this module (the enforced
 * graph: `customers → core, identity, catalog`). The admin's customer
 * directory joins the two above both — see
 * `src/lib/admin/customer-directory.ts`.
 *
 * Currency is deliberately absent from the result: `Order.currency` is
 * per-order, and summing across currencies would be wrong. Every order in
 * this store is placed in the store's one configured currency (settings),
 * so the caller labels the total with that rather than this pretending to
 * have resolved a mix it cannot.
 */
export async function getOrderStatsForCustomers(
  customerIds: string[],
): Promise<Map<string, CustomerOrderStats>> {
  const stats = new Map<string, CustomerOrderStats>();
  if (customerIds.length === 0) return stats;

  const [counts, paid] = await Promise.all([
    db.order.groupBy({
      by: ['customerId'],
      where: { customerId: { in: customerIds } },
      _count: { _all: true },
      _max: { placedAt: true },
    }),
    db.order.groupBy({
      by: ['customerId'],
      where: { customerId: { in: customerIds }, paymentStatus: 'PAID' },
      _sum: { totalMinor: true },
    }),
  ]);

  const paidByCustomer = new Map(
    paid.map((row) => [row.customerId ?? '', row._sum.totalMinor ?? 0]),
  );

  for (const row of counts) {
    if (!row.customerId) continue;
    stats.set(row.customerId, {
      customerId: row.customerId,
      orderCount: row._count._all,
      paidTotalMinor: paidByCustomer.get(row.customerId) ?? 0,
      lastOrderAt: row._max.placedAt,
    });
  }

  return stats;
}
