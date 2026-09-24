import { redirect } from 'next/navigation';

import { isAppError } from '@/modules/core';
import {
  requirePermission,
  requireUser,
  type AuthenticatedUser,
  type Permission,
} from '@/modules/identity';

/**
 * Page-level wrappers around `identity`'s `requireUser`/`requirePermission`.
 * Those two stay pure throws (Task 22's security tests call them directly
 * and assert on the thrown `AppError` — they must never redirect); this is
 * the page-rendering half of the same check, for the exact `UNAUTHENTICATED`
 * case a page reaches under Next's own auth gate.
 *
 * Every protected page under `(shell)` also runs `(shell)/layout.tsx`'s own
 * `auth()` check, which redirects first in the common case — but Next.js
 * renders a route segment's layout and page concurrently, not strictly
 * layout-then-page, so a signed-out page render can still reach its own
 * `requireUser()` call before the layout's `redirect()` wins the race. A
 * bare throw there surfaces as an uncaught `AppError` (an error-boundary
 * flash) instead of the same clean redirect the layout was already giving —
 * so the page's own check redirects on `UNAUTHENTICATED` too, matching what
 * the user was always going to see, while `FORBIDDEN` (signed in, wrong
 * role) still propagates as a real error: that one is worth showing, not
 * hiding behind a silent redirect.
 */
export async function requireAdminUser(): Promise<AuthenticatedUser> {
  try {
    return await requireUser();
  } catch (error) {
    if (isAppError(error) && error.code === 'UNAUTHENTICATED') redirect('/admin/login');
    throw error;
  }
}

export async function requireAdminPermission(permission: Permission): Promise<AuthenticatedUser> {
  try {
    return await requirePermission(permission);
  } catch (error) {
    if (isAppError(error) && error.code === 'UNAUTHENTICATED') redirect('/admin/login');
    throw error;
  }
}
