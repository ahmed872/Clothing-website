import 'server-only';

import type { Prisma } from '@generated/prisma';

import { db } from '@/modules/core';

/**
 * Reading customers, for the admin (P15).
 *
 * Read-only on purpose, and not for want of effort: `customers.read` is the
 * only customer permission the RBAC table has, and every write an admin
 * might want here already belongs to someone else. Disabling an account is
 * `users.manage`'s job and `setStaffActive` deliberately refuses a CUSTOMER
 * target (P14); editing a profile is the customer's own, through their
 * account; deleting one is a data-retention decision no phase has specified.
 * A screen that offered any of those would be inventing authority the
 * permission model does not grant.
 *
 * What this module must *not* do is reach into orders: `customers` may
 * depend on core/identity/catalog and nothing else. Order counts and totals
 * come from `orders`' own query and are joined above both, in
 * `src/lib/admin/customer-directory.ts` — the same composition
 * `customer-identity.ts` already uses for the same reason.
 */

export type CustomerSort = 'created_desc' | 'created_asc' | 'name_asc';

export interface CustomerListQuery {
  /** Matches email or name, case-insensitively. */
  q?: string;
  /** `verified` / `unverified` by `User.emailVerifiedAt`. */
  verified?: 'verified' | 'unverified';
  sort?: CustomerSort;
  page?: number;
  pageSize?: number;
}

export interface CustomerListItem {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  phone: string | null;
  emailVerifiedAt: Date | null;
  active: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface CustomerAddressView {
  id: string;
  type: 'SHIPPING' | 'BILLING';
  fullName: string;
  phone: string;
  city: string;
  district: string | null;
  line1: string;
  line2: string | null;
  postalCode: string | null;
  country: string;
  isDefault: boolean;
}

export interface CustomerDetail extends CustomerListItem {
  locale: 'AR' | 'EN';
  addresses: CustomerAddressView[];
}

export interface PaginatedCustomers {
  items: CustomerListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function paginationOf(query: CustomerListQuery) {
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(query.pageSize ?? DEFAULT_PAGE_SIZE)),
  );
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * Every filter is expressed through the `User` relation because that is
 * where identity lives — a `Customer` row carries only a phone number. The
 * search is `contains`/`insensitive` on two columns rather than a
 * full-text index: the staff list this mirrors is small, and adding an
 * index without a query that needs it is exactly what P14's database pass
 * said not to do.
 */
function whereFor(query: CustomerListQuery): Prisma.CustomerWhereInput {
  const where: Prisma.CustomerWhereInput = {};
  const user: Prisma.UserWhereInput = { role: 'CUSTOMER' };

  const term = query.q?.trim();
  if (term) {
    user.OR = [
      { email: { contains: term, mode: 'insensitive' } },
      { name: { contains: term, mode: 'insensitive' } },
    ];
  }

  if (query.verified === 'verified') user.emailVerifiedAt = { not: null };
  if (query.verified === 'unverified') user.emailVerifiedAt = null;

  where.user = user;
  return where;
}

function orderByFor(sort: CustomerSort | undefined): Prisma.CustomerOrderByWithRelationInput {
  switch (sort) {
    case 'created_asc':
      return { createdAt: 'asc' };
    case 'name_asc':
      return { user: { name: 'asc' } };
    default:
      return { createdAt: 'desc' };
  }
}

const LIST_SELECT = {
  id: true,
  userId: true,
  phone: true,
  createdAt: true,
  user: {
    select: {
      name: true,
      email: true,
      emailVerifiedAt: true,
      active: true,
      lastLoginAt: true,
    },
  },
} satisfies Prisma.CustomerSelect;

type ListRow = Prisma.CustomerGetPayload<{ select: typeof LIST_SELECT }>;

function toListItem(row: ListRow): CustomerListItem {
  return {
    id: row.id,
    userId: row.userId,
    name: row.user.name,
    email: row.user.email,
    phone: row.phone,
    emailVerifiedAt: row.user.emailVerifiedAt,
    active: row.user.active,
    createdAt: row.createdAt,
    lastLoginAt: row.user.lastLoginAt,
  };
}

export async function listCustomersForAdmin(
  query: CustomerListQuery = {},
): Promise<PaginatedCustomers> {
  const { page, pageSize, skip, take } = paginationOf(query);
  const where = whereFor(query);

  const [rows, total] = await Promise.all([
    db.customer.findMany({
      where,
      select: LIST_SELECT,
      orderBy: orderByFor(query.sort),
      skip,
      take,
    }),
    db.customer.count({ where }),
  ]);

  return {
    items: rows.map(toListItem),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Returns `null` for both "no such customer" and "that id belongs to
 * something that is not a customer" — the admin has no use for the
 * distinction, and collapsing them keeps this from confirming which ids
 * exist. */
export async function getCustomerForAdmin(id: string): Promise<CustomerDetail | null> {
  const row = await db.customer.findFirst({
    where: { id, user: { role: 'CUSTOMER' } },
    select: {
      ...LIST_SELECT,
      user: { select: { ...LIST_SELECT.user.select, locale: true } },
      addresses: {
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          type: true,
          fullName: true,
          phone: true,
          city: true,
          district: true,
          line1: true,
          line2: true,
          postalCode: true,
          country: true,
          isDefault: true,
        },
      },
    },
  });

  if (!row) return null;

  return {
    ...toListItem(row),
    locale: row.user.locale,
    addresses: row.addresses,
  };
}
