'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { adminErrorMessage } from '@/lib/admin/admin-error-message';
import {
  createStaffUser,
  passwordPolicySchema,
  recordAuditEvent,
  requirePermission,
  setStaffActive,
  setStaffRole,
  STAFF_ROLES,
} from '@/modules/identity';
import type { Locale } from '@/lib/i18n/locales';
import type { ActionResult } from '@/lib/admin/action-result';

/**
 * Staff administration (P14 §B) — the one surface that creates an admin
 * account, changes what an admin may do, and switches one off.
 *
 * Same shape as every other admin action file (`brand-actions.ts` et al):
 * `requirePermission` first, then the domain service, then an audit event,
 * then revalidate — returned as a plain `ActionResult` rather than a thrown
 * error. Two things are stricter here than anywhere else in the admin, and
 * deliberately so:
 *
 *   - **`users.manage` is OWNER-only** (`permissions.ts`), so a MANAGER —
 *     who may otherwise do everything in the store — is refused by the very
 *     first line of each action. That check is the real authority: the
 *     sidebar simply never renders the link for them, which is a
 *     convenience, not a control (P06 §7/§17).
 *   - **The actor is always the session's user**, never a parameter. Every
 *     one of these functions is a public HTTP endpoint the moment it is
 *     imported by a client component, so an `actorId` argument would be an
 *     attacker-chosen value; `requirePermission()` returns the only identity
 *     that is allowed to matter here.
 *
 * Every audit entry is written with `entityType: 'User'` and the *subject*
 * in `entityId` — matching `audit.service.ts`'s own convention for account
 * events — while `userId` carries the acting owner, so "who promoted whom"
 * is answerable from the log alone.
 */

const roleSchema = z.enum(STAFF_ROLES);

const createStaffSchema = z.object({
  email: z.string().trim().min(1).max(254).email(),
  name: z.string().trim().max(120).optional(),
  // The same policy the bootstrap script and every other credential path
  // enforce — never a weaker one because this form happens to be behind a
  // login (P06 §4).
  password: passwordPolicySchema,
  role: roleSchema,
});

export interface CreateStaffUserFormInput {
  email: string;
  name: string;
  password: string;
  role: string;
}

export async function createStaffUserAction(
  input: CreateStaffUserFormInput,
  locale: Locale,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission('users.manage');
    const parsed = createStaffSchema.parse({
      email: input.email,
      name: input.name.trim() === '' ? undefined : input.name,
      password: input.password,
      role: input.role,
    });

    const created = await createStaffUser({
      email: parsed.email,
      name: parsed.name ?? null,
      password: parsed.password,
      role: parsed.role,
    });

    await recordAuditEvent({
      action: 'user.created',
      entityType: 'User',
      // The acting owner, not the new account — `entityId` below is the
      // subject. A row where both are the same id would be unreadable.
      userId: actor.id,
      entityId: created.id,
      // Never the password, and never the hash: `audit.service.ts` says so
      // in its own header, and this is the one call site that could most
      // easily get it wrong.
      after: { email: created.email, role: created.role, active: created.active },
    });

    revalidatePath('/admin/users');
    return { ok: true, data: { id: created.id } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function setStaffRoleAction(
  userId: string,
  role: string,
  locale: Locale,
): Promise<ActionResult> {
  try {
    const actor = await requirePermission('users.manage');
    const parsedRole = roleSchema.parse(role);

    const { user, previousRole } = await setStaffRole({
      actorId: actor.id,
      userId,
      role: parsedRole,
    });

    await recordAuditEvent({
      action: 'user.role_changed',
      entityType: 'User',
      userId: actor.id,
      entityId: userId,
      before: { role: previousRole },
      after: { role: user.role, email: user.email },
    });

    revalidatePath('/admin/users');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function setStaffActiveAction(
  userId: string,
  active: boolean,
  locale: Locale,
): Promise<ActionResult> {
  try {
    const actor = await requirePermission('users.manage');
    const { user, revokedSessions } = await setStaffActive({ actorId: actor.id, userId, active });

    await recordAuditEvent({
      action: active ? 'user.enabled' : 'user.disabled',
      entityType: 'User',
      userId: actor.id,
      entityId: userId,
      before: { active: !active },
      after: { active: user.active, email: user.email, revokedSessions },
    });

    revalidatePath('/admin/users');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}
