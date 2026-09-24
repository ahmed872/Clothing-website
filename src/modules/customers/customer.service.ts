import 'server-only';

import type { Customer, Locale, User } from '@generated/prisma';

import { db, AppError } from '@/modules/core';
import { hashPassword } from '@/modules/identity';

/**
 * The `Customer` row behind a signed-in `User`.
 *
 * P09 needs this much of `customers` and no more: a cart owned by a
 * customer references `Customer`, not `User`, so signing in has to be able
 * to find — or open — that row. Everything else this module will own
 * (addresses, wishlist, reviews) is still P10's.
 *
 * Created on demand rather than at registration: a `User` who never shops
 * has no reason to have a customer record, and creating one lazily means
 * accounts that predate this phase work without a backfill.
 */
export async function resolveCustomerForUser(userId: string): Promise<Customer> {
  const existing = await db.customer.findUnique({ where: { userId } });
  if (existing) return existing;

  // `upsert` rather than `create`: two requests from the same person can
  // arrive together (a page load and its own cart fetch), and the unique
  // index on `user_id` would turn the loser into a 500.
  return db.customer.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function findCustomerForUser(userId: string): Promise<Customer | null> {
  return db.customer.findUnique({ where: { userId } });
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface RegisterCustomerInput {
  email: string;
  password: string;
  name: string;
  /** Optional at registration — checkout still asks for one either way, and
   * forcing it here would be one more field between a shopper and an
   * account. */
  phone?: string | null;
  /** The storefront locale the customer actually registered through
   * (`registerAction` already knows it from the URL) — persisted so P13's
   * dispatcher sends every later notification in the language the customer
   * chose, not the schema's `AR` default regardless of which page they
   * used. Optional because `resolveCustomerForUser`'s lazy path creates a
   * `User` with no registration moment at all to read one from. */
  locale?: Locale;
}

export interface RegisteredCustomer {
  user: User;
  customer: Customer;
}

/**
 * Creates the `User` and its `Customer` row together, in one transaction —
 * unlike `resolveCustomerForUser`'s lazy on-demand creation, registration is
 * an explicit "become a customer" action, so both rows exist from the first
 * moment rather than waiting for a first cart touch (P12 §2).
 *
 * `role` is never a parameter: it is hard-coded to `CUSTOMER` here and
 * nowhere in this function's input accepts anything else, which is what
 * makes "a registration request selects OWNER" structurally impossible
 * rather than merely rejected (P12 §3) — the same "no field to tamper with"
 * posture P10's checkout input already uses for price and status.
 *
 * The email's uniqueness is the database's `@unique` constraint, not a
 * pre-check: two concurrent registrations for the same normalized email
 * both attempt the insert, and only one can win — a pre-check-then-insert
 * would leave exactly the race P12 §27 asks to be closed (P10/P11 already
 * established this is the only way an application-level check can't lose
 * to a race, for the idempotency key and the payment slot alike).
 */
export async function registerCustomer(input: RegisterCustomerInput): Promise<RegisteredCustomer> {
  const passwordHash = await hashPassword(input.password);
  const email = normalizeEmail(input.email);

  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          name: input.name.trim(),
          role: 'CUSTOMER',
          ...(input.locale ? { locale: input.locale } : {}),
        },
      });
      const customer = await tx.customer.create({
        data: { userId: user.id, phone: input.phone?.trim() || null },
      });
      return { user, customer };
    });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    ) {
      throw new AppError('CONFLICT', {
        cause: error,
        details: { field: 'email' },
        internalMessage: 'email already registered',
      });
    }
    throw error;
  }
}

export interface UpdateCustomerProfileInput {
  name?: string;
  phone?: string | null;
}

/**
 * Name and phone only (P12 §11). Email is deliberately not here: changing
 * it safely needs a verification step to prove the new address belongs to
 * the person asking, and with no real mail transport configured yet
 * (P13's job — see `token.service.ts`), a same-request "just change it"
 * would either be unverified or claim a verification that never happened.
 * Neither is worth shipping, so email stays read-only in P12 rather than
 * shipping a half-secure version of the real feature.
 *
 * Last-write-wins on purpose: a customer's own name and phone are
 * single-owner, low-stakes fields with no financial or inventory
 * consequence, unlike stock or price — the optimistic-concurrency machinery
 * P08 needed there would be manufactured complexity here.
 */
export async function updateCustomerProfile(
  userId: string,
  input: UpdateCustomerProfileInput,
): Promise<{ user: User; customer: Customer }> {
  const customer = await resolveCustomerForUser(userId);

  const [user, updatedCustomer] = await db.$transaction([
    db.user.update({
      where: { id: userId },
      data: input.name !== undefined ? { name: input.name.trim() } : {},
    }),
    db.customer.update({
      where: { id: customer.id },
      data: input.phone !== undefined ? { phone: input.phone?.trim() || null } : {},
    }),
  ]);

  return { user, customer: updatedCustomer };
}
