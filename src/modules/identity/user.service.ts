import 'server-only';

import type { Prisma, Role, User } from '@generated/prisma';

import { db, AppError } from '@/modules/core';

import { hashPassword, verifyPassword } from './password';
import { isAdminRole } from './permissions';
import { mapUniqueConstraint } from './prisma-errors';

/**
 * The User domain: identity, credential, status, and role — the one place
 * every other identity concern (sessions, RBAC, audit) reads "who is this
 * and what may they do" from.
 */

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string | null;
  role: Role;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getUserByEmail(email: string): Promise<User | null> {
  return db.user.findUnique({ where: { email: normalizeEmail(email) } });
}

export async function getUserById(id: string): Promise<User | null> {
  return db.user.findUnique({ where: { id } });
}

/**
 * The staff accounts an admin screen can filter or attribute by — every
 * role that can act on the store, customers excluded.
 *
 * Selected down to id/name/email/role on purpose: this feeds a filter
 * dropdown and an "who did this" column, and neither has any business
 * receiving a password hash. Never widen this to the whole `User` row.
 */
export async function listStaffUsers(): Promise<
  { id: string; name: string | null; email: string; role: Role }[]
> {
  return db.user.findMany({
    where: { role: { not: 'CUSTOMER' } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ name: 'asc' }, { email: 'asc' }],
  });
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.user.create({
      data: {
        email: normalizeEmail(input.email),
        passwordHash,
        name: input.name ?? null,
        role: input.role,
      },
    });
  } catch (error) {
    throw mapUniqueConstraint(error, 'email');
  }
}

export async function setUserActive(id: string, active: boolean): Promise<User> {
  const user = await getUserById(id);
  if (!user) throw new AppError('NOT_FOUND', { details: { entity: 'User', id } });
  return db.user.update({ where: { id }, data: { active } });
}

export async function setUserRole(id: string, role: Role): Promise<User> {
  const user = await getUserById(id);
  if (!user) throw new AppError('NOT_FOUND', { details: { entity: 'User', id } });
  return db.user.update({ where: { id }, data: { role } });
}

// ---------------------------------------------------------------------------
// Staff administration (P14)
// ---------------------------------------------------------------------------

/**
 * The roles a staff account may hold — `Role` minus `CUSTOMER`.
 *
 * `CUSTOMER` is absent on purpose, and it is the single most important line
 * in this file's P14 addition. A storefront account is not merely a `User`
 * row with a different enum value: `registerCustomer` creates a matching
 * `Customer` row that every cart, order, address and review is keyed by
 * (`customers` module, P12). Letting the staff screen write `CUSTOMER` onto
 * a `User` would mint a storefront identity with no `Customer` row behind
 * it; letting it write a staff role onto an existing customer's `User` id
 * would hand a shopper the admin panel. Both directions are refused —
 * assignment is narrowed by this type, and the *target* is re-checked
 * against the database in `setStaffRole`/`setStaffActive` below, because a
 * type says nothing about the id a crafted request supplies.
 */
export const STAFF_ROLES = ['STAFF', 'MANAGER', 'OWNER'] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}

/**
 * The staff-administration list (P14 §B) — everything the screen shows and
 * nothing else.
 *
 * Separate from `listStaffUsers` above rather than a widening of it:
 * that one feeds an attribution dropdown and its comment says never to
 * widen it. Both select explicit columns, so neither can ever return
 * `passwordHash` — the field is not in the projection at all, which is a
 * stronger guarantee than deleting it afterwards.
 */
export interface AdminUserListItem {
  id: string;
  email: string;
  name: string | null;
  role: StaffRole;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export async function listAdminUsers(): Promise<AdminUserListItem[]> {
  const users = await db.user.findMany({
    where: { role: { not: 'CUSTOMER' } },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  // `role: { not: 'CUSTOMER' }` already guarantees this, but narrowing the
  // type here rather than casting keeps the guarantee checkable.
  return users.filter((user): user is AdminUserListItem => isStaffRole(user.role));
}

export interface CreateStaffUserInput {
  email: string;
  password: string;
  name?: string | null;
  role: StaffRole;
}

/** `createUser` narrowed to staff roles — the only creation path the admin
 * screen has, so "an admin created a CUSTOMER" is not expressible here. */
export async function createStaffUser(input: CreateStaffUserInput): Promise<User> {
  return createUser(input);
}

export interface StaffMutationInput {
  /** The signed-in admin performing the change. Never taken from a form
   * field — the action layer reads it from the session. */
  actorId: string;
  userId: string;
}

/** What a staff mutation gives its caller back: the updated row, plus
 * whatever the audit entry needs to say what actually changed. */
export interface StaffMutationResult {
  user: User;
}

/**
 * Runs `fn` with every currently-active OWNER row locked, in a fixed order.
 *
 * The "there must always be at least one active OWNER" rule spans rows, so
 * locking only the row being changed is not enough: two admins demoting two
 * *different* owners at the same moment would each count the other as still
 * an owner and both succeed, leaving a store nobody can administer. Taking
 * the same lock set — ordered by id, so two callers can never take it in
 * opposite orders and deadlock — serialises them: the second transaction
 * blocks, then re-reads the first one's committed result and refuses.
 *
 * `FOR UPDATE` under Postgres' default READ COMMITTED re-evaluates the
 * `WHERE` after the lock is granted, so a row that stopped being an active
 * owner while we waited correctly drops out of the set. Same row-lock
 * discipline `cancelOrder` (P10 §18) already uses for its own race.
 */
async function withActiveOwnersLocked<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE role = 'OWNER'::"Role" AND active = true ORDER BY id FOR UPDATE`;
    return fn(tx);
  });
}

/** The target of a staff mutation, after every check that does not depend on
 * what is being changed. Throws rather than returning a failure union: the
 * action layer turns an `AppError`'s `reasonCode` into a bilingual sentence
 * (see `admin-error-message.ts`), which is the established shape for every
 * admin mutation in this codebase. */
async function loadStaffTarget(
  tx: Prisma.TransactionClient,
  input: StaffMutationInput,
  selfReasonCode: string,
): Promise<{ id: string; email: string; role: StaffRole; active: boolean }> {
  const target = await tx.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, role: true, active: true },
  });
  if (!target) {
    throw new AppError('NOT_FOUND', { details: { entity: 'User', id: input.userId } });
  }

  // The IDOR guard. `users.manage` says "you may administer staff", not
  // "you may rewrite any row in the users table" — a customer's id posted
  // to this action is refused here, before any write, rather than being
  // caught by the fact that the UI never lists customers.
  if (!isStaffRole(target.role)) {
    throw new AppError('FORBIDDEN', {
      internalMessage: 'Staff administration was called with a non-staff target',
      details: { reasonCode: 'not_a_staff_account' },
    });
  }

  // An admin cannot revoke their own access while using it. There is no
  // operational need — another owner can do it, which is also the audit
  // trail a privilege change should have — and the failure mode is losing
  // the admin panel mid-session with no way back in.
  if (target.id === input.actorId) {
    throw new AppError('CONFLICT', {
      internalMessage: 'Staff administration was called against the acting admin',
      details: { reasonCode: selfReasonCode },
    });
  }

  return { ...target, role: target.role };
}

/** Would this change leave the store with no active OWNER? Called inside
 * `withActiveOwnersLocked`, so the count it reads cannot move underneath it. */
async function assertNotLastOwner(
  tx: Prisma.TransactionClient,
  target: { id: string; role: StaffRole; active: boolean },
  stillAnActiveOwnerAfterwards: boolean,
): Promise<void> {
  if (stillAnActiveOwnerAfterwards) return;
  if (target.role !== 'OWNER' || !target.active) return;

  const others = await tx.user.count({
    where: { role: 'OWNER', active: true, id: { not: target.id } },
  });
  if (others === 0) {
    throw new AppError('CONFLICT', {
      internalMessage: 'Refused to remove the last active OWNER',
      details: { reasonCode: 'last_owner' },
    });
  }
}

/**
 * Change a staff account's role (P14 §B).
 *
 * `role` is a `StaffRole`, the target is proven to be staff, the actor
 * cannot be the target, and the last active OWNER cannot be demoted. The
 * session behind a demoted account is *not* revoked and does not need to
 * be: `auth.ts`'s `jwt` callback re-reads the live user on every request,
 * so the new role is in force on their very next page load (P06).
 */
export async function setStaffRole(
  input: StaffMutationInput & { role: StaffRole },
): Promise<StaffMutationResult & { previousRole: StaffRole }> {
  return withActiveOwnersLocked(async (tx) => {
    const target = await loadStaffTarget(tx, input, 'cannot_change_own_role');
    await assertNotLastOwner(tx, target, input.role === 'OWNER');
    const user = await tx.user.update({ where: { id: target.id }, data: { role: input.role } });
    return { user, previousRole: target.role };
  });
}

/**
 * Enable or disable a staff account (P14 §B).
 *
 * Disabling revokes every `Session` row the account holds, inside the same
 * transaction as the flag itself — so "disabled" and "signed out" can never
 * disagree, even if the process dies between them. `jwt` would reject the
 * account on its next request regardless (it checks `active`); deleting the
 * rows as well means a disabled account leaves no live session behind for
 * anything else to find.
 */
export async function setStaffActive(
  input: StaffMutationInput & { active: boolean },
): Promise<StaffMutationResult & { revokedSessions: number }> {
  return withActiveOwnersLocked(async (tx) => {
    const target = await loadStaffTarget(tx, input, 'cannot_disable_self');
    await assertNotLastOwner(tx, target, input.active);

    const user = await tx.user.update({
      where: { id: target.id },
      data: { active: input.active },
    });
    const revoked = input.active
      ? { count: 0 }
      : await tx.session.deleteMany({ where: { userId: target.id } });
    return { user, revokedSessions: revoked.count };
  });
}

export type CredentialFailureReason =
  'NOT_FOUND' | 'NO_PASSWORD' | 'WRONG_PASSWORD' | 'DISABLED' | 'NOT_ADMIN';

export type VerifyCredentialsResult =
  { ok: true; user: User } | { ok: false; reason: CredentialFailureReason };

/**
 * Verifies email + password for the admin login flow specifically: beyond a
 * matching password, the account must be active and hold an admin role
 * (`STAFF`/`MANAGER`/`OWNER`) — a `CUSTOMER` account, even with a correct
 * password, is not an admin-area credential.
 *
 * Every failure branch is distinguished only for internal logging
 * (`auth.ts` records the `reason` to the audit log); the caller-facing
 * message is always the same generic "invalid credentials" text (see
 * `auth.ts`) so a failed login never tells an attacker *which* fact was
 * wrong.
 */
export async function verifyAdminCredentials(
  email: string,
  password: string,
): Promise<VerifyCredentialsResult> {
  const user = await getUserByEmail(email);
  if (!user) return { ok: false, reason: 'NOT_FOUND' };
  if (!user.passwordHash) return { ok: false, reason: 'NO_PASSWORD' };

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return { ok: false, reason: 'WRONG_PASSWORD' };

  if (!user.active) return { ok: false, reason: 'DISABLED' };
  if (!isAdminRole(user.role)) return { ok: false, reason: 'NOT_ADMIN' };

  return { ok: true, user };
}

export async function touchLastLogin(id: string): Promise<void> {
  await db.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
}

export type VerifyCustomerFailureReason =
  'NOT_FOUND' | 'NO_PASSWORD' | 'WRONG_PASSWORD' | 'DISABLED' | 'NOT_CUSTOMER';

export type VerifyCustomerCredentialsResult =
  { ok: true; user: User } | { ok: false; reason: VerifyCustomerFailureReason };

/**
 * The storefront twin of `verifyAdminCredentials` (P12 §5): same shape,
 * same generic-failure discipline, but the role gate runs the other way —
 * an admin account, even with a correct password, is not a storefront
 * credential. `NOT_CUSTOMER` covers it, and like `NOT_ADMIN` above, only
 * ever reaches an audit log, never the caller.
 */
export async function verifyCustomerCredentials(
  email: string,
  password: string,
): Promise<VerifyCustomerCredentialsResult> {
  const user = await getUserByEmail(email);
  if (!user) return { ok: false, reason: 'NOT_FOUND' };
  if (!user.passwordHash) return { ok: false, reason: 'NO_PASSWORD' };

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return { ok: false, reason: 'WRONG_PASSWORD' };

  if (!user.active) return { ok: false, reason: 'DISABLED' };
  if (user.role !== 'CUSTOMER') return { ok: false, reason: 'NOT_CUSTOMER' };

  return { ok: true, user };
}
