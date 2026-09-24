import 'server-only';

import type { Role } from '@generated/prisma';

import { AppError } from '@/modules/core';

import { auth } from './auth';
import { customerAuth } from './customer-auth';
import { type Permission, roleHasPermission } from './permissions';

/**
 * The one place every Server Component, Server Action, and Route Handler in
 * `/admin` goes through to answer "who is calling, and may they do this."
 *
 * Never a UI-only check: a hidden button is not authorization (P06 §7) —
 * every mutating server boundary calls `requirePermission` (or, for a
 * read that only needs "is signed in", `requireUser`) itself, so a direct
 * call — curl, a typed URL, a crafted form POST — is rejected exactly the
 * same as a blocked UI action would have been.
 */

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
}

/** Throws `AppError('UNAUTHENTICATED')` when there is no valid session —
 * never returns `null` silently, so a caller can't forget to check. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const session = await auth();
  const user = session?.user;

  if (!user?.id || !user.role) {
    throw new AppError('UNAUTHENTICATED');
  }

  return {
    id: user.id,
    email: user.email ?? '',
    name: user.name ?? null,
    role: user.role,
  };
}

/** `requireUser` plus a specific permission check. Throws
 * `AppError('FORBIDDEN')` when the caller's role lacks `permission` —
 * this is the call every admin mutation makes as its very first line. */
export async function requirePermission(permission: Permission): Promise<AuthenticatedUser> {
  const user = await requireUser();

  if (!roleHasPermission(user.role, permission)) {
    throw new AppError('FORBIDDEN', { details: { permission } });
  }

  return user;
}

/** Read-only helper for places that want to branch on the session without
 * enforcing it (e.g. rendering a nav item only when it exists) — never a
 * substitute for `requireUser`/`requirePermission` on an actual boundary. */
export async function getOptionalUser(): Promise<AuthenticatedUser | null> {
  try {
    return await requireUser();
  } catch {
    return null;
  }
}

/**
 * The storefront twin of `requireUser`/`getOptionalUser`, backed by
 * `customerAuth()` — a completely separate Auth.js instance reading a
 * completely separate cookie (see `customer-auth.ts`). This module cannot
 * also resolve the `Customer` row a signed-in user owns: `customers`
 * depends on `identity`, not the other way around, so doing that here would
 * be a dependency cycle. `src/lib/customers/customer-identity.ts` is where
 * the two are composed, the same way `cart-identity.ts` already composes
 * a session identity with `resolveCustomerForUser`.
 */
export async function requireCustomerUser(): Promise<AuthenticatedUser> {
  const session = await customerAuth();
  const user = session?.user;

  if (!user?.id || user.role !== 'CUSTOMER') {
    throw new AppError('UNAUTHENTICATED');
  }

  return {
    id: user.id,
    email: user.email ?? '',
    name: user.name ?? null,
    role: user.role,
  };
}

export async function getOptionalCustomerUser(): Promise<AuthenticatedUser | null> {
  try {
    return await requireCustomerUser();
  } catch {
    return null;
  }
}
