import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@generated/prisma';

import { db } from '@/modules/core';
import { resetIdentityTables } from '@/modules/identity/testing';
import { createUser } from '@/modules/identity/user.service';
import { createDbSession } from '@/modules/identity/session.service';
import { verifyPassword } from '@/modules/identity/password';

/**
 * Staff administration's authorization matrix (P14 §B/§H), exercised
 * against the server actions themselves — never through the UI. Hiding the
 * Administration group from a MANAGER's sidebar proves nothing; these prove
 * the server refuses.
 *
 * The claims that matter here are all about what an admin screen must *not*
 * let happen: a MANAGER cannot grant themselves more, an owner cannot
 * disable themselves, a customer's `User` row cannot be promoted into the
 * admin panel through a crafted id, and the store can never be left with
 * nobody who can administer it.
 */

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  // `updateTag` is what the admin actions call for read-your-own-writes
  // cache invalidation; a mock missing it fails as "not a function".
  updateTag: vi.fn(),
}));

const authMock = vi.fn();
vi.mock('@/modules/identity/auth', () => ({ auth: authMock }));

const { createStaffUserAction, setStaffRoleAction, setStaffActiveAction } =
  await import('./user-actions');

const ACTOR_ID = '00000000-0000-4000-8000-0000000000aa';

function signInAs(role: Role | null): void {
  authMock.mockResolvedValue(
    role
      ? {
          user: { id: ACTOR_ID, email: `${role.toLowerCase()}@example.com`, name: null, role },
          expires: '2099-01-01T00:00:00.000Z',
        }
      : null,
  );
}

async function seedActor(role: Role): Promise<void> {
  const user = await createUser({
    email: `actor-${role.toLowerCase()}@example.com`,
    password: 'matrix-pass-123',
    role,
  });
  await db.user.update({ where: { id: user.id }, data: { id: ACTOR_ID } });
}

let subjectCounter = 0;

async function seedSubject(role: Role, active = true) {
  subjectCounter += 1;
  const user = await createUser({
    email: `subject-${subjectCounter}@example.com`,
    password: 'subject-pass-123',
    role,
  });
  if (!active) await db.user.update({ where: { id: user.id }, data: { active: false } });
  return user;
}

function newUserForm(overrides: Record<string, string> = {}) {
  subjectCounter += 1;
  return {
    email: `created-${subjectCounter}@example.com`,
    name: 'Created Person',
    password: 'a-strong-password-9',
    role: 'STAFF',
    ...overrides,
  };
}

beforeEach(async () => {
  await resetIdentityTables();
  authMock.mockReset();
});

describe('permission matrix', () => {
  const ROLES: Role[] = ['OWNER', 'MANAGER', 'STAFF', 'CUSTOMER'];

  /** Written out literally rather than derived from `ROLE_PERMISSIONS`, so
   * a change to who may administer users has to be made deliberately in two
   * places. `users.manage` is OWNER-only — a MANAGER runs the store but does
   * not hand out access to it. */
  const ALLOWED: Role[] = ['OWNER'];

  for (const role of ROLES) {
    const expected = ALLOWED.includes(role);

    it(`createStaffUserAction: ${role} is ${expected ? 'allowed' : 'refused'}`, async () => {
      await seedActor(role);
      signInAs(role);
      expect((await createStaffUserAction(newUserForm(), 'en')).ok).toBe(expected);
    });

    it(`setStaffRoleAction: ${role} is ${expected ? 'allowed' : 'refused'}`, async () => {
      await seedActor(role);
      // A second OWNER exists so the last-owner rule never masks a
      // permission result.
      await seedSubject('OWNER');
      const subject = await seedSubject('STAFF');
      signInAs(role);
      expect((await setStaffRoleAction(subject.id, 'MANAGER', 'en')).ok).toBe(expected);
    });

    it(`setStaffActiveAction: ${role} is ${expected ? 'allowed' : 'refused'}`, async () => {
      await seedActor(role);
      const subject = await seedSubject('STAFF');
      signInAs(role);
      expect((await setStaffActiveAction(subject.id, false, 'en')).ok).toBe(expected);
    });
  }

  it('a signed-out caller is refused everything', async () => {
    const subject = await seedSubject('STAFF');
    signInAs(null);

    expect((await createStaffUserAction(newUserForm(), 'en')).ok).toBe(false);
    expect((await setStaffRoleAction(subject.id, 'OWNER', 'en')).ok).toBe(false);
    expect((await setStaffActiveAction(subject.id, false, 'en')).ok).toBe(false);
  });

  it('a refused call changes nothing and writes no success audit entry', async () => {
    await seedActor('MANAGER');
    const subject = await seedSubject('STAFF');
    signInAs('MANAGER');

    await createStaffUserAction(newUserForm({ email: 'sneaky@example.com' }), 'en');
    await setStaffRoleAction(subject.id, 'OWNER', 'en');
    await setStaffActiveAction(subject.id, false, 'en');

    expect(await db.user.count({ where: { email: 'sneaky@example.com' } })).toBe(0);
    const after = await db.user.findUniqueOrThrow({ where: { id: subject.id } });
    expect(after.role).toBe('STAFF');
    expect(after.active).toBe(true);
    expect(await db.auditLog.count()).toBe(0);
  });
});

describe('role escalation', () => {
  it('a MANAGER cannot promote themselves to OWNER', async () => {
    await seedActor('MANAGER');
    signInAs('MANAGER');

    const result = await setStaffRoleAction(ACTOR_ID, 'OWNER', 'en');

    expect(result.ok).toBe(false);
    expect((await db.user.findUniqueOrThrow({ where: { id: ACTOR_ID } })).role).toBe('MANAGER');
  });

  it('a CUSTOMER account cannot be promoted into the admin panel by id', async () => {
    await seedActor('OWNER');
    const customer = await seedSubject('CUSTOMER');
    signInAs('OWNER');

    const result = await setStaffRoleAction(customer.id, 'OWNER', 'en');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('not a team account');
    expect((await db.user.findUniqueOrThrow({ where: { id: customer.id } })).role).toBe('CUSTOMER');
  });

  it('a CUSTOMER account cannot be disabled through the staff screen either', async () => {
    await seedActor('OWNER');
    const customer = await seedSubject('CUSTOMER');
    signInAs('OWNER');

    expect((await setStaffActiveAction(customer.id, false, 'en')).ok).toBe(false);
    expect((await db.user.findUniqueOrThrow({ where: { id: customer.id } })).active).toBe(true);
  });

  it('CUSTOMER is not an assignable role, however it is spelled', async () => {
    await seedActor('OWNER');
    await seedSubject('OWNER');
    const subject = await seedSubject('STAFF');
    signInAs('OWNER');

    for (const attempt of ['CUSTOMER', 'customer', 'owner', 'SUPERUSER', '']) {
      expect((await setStaffRoleAction(subject.id, attempt, 'en')).ok).toBe(false);
    }
    expect((await db.user.findUniqueOrThrow({ where: { id: subject.id } })).role).toBe('STAFF');

    expect((await createStaffUserAction(newUserForm({ role: 'CUSTOMER' }), 'en')).ok).toBe(false);
    expect(await db.user.count({ where: { role: 'CUSTOMER' } })).toBe(0);
  });

  it('an unknown user id is refused, and says nothing about which ids exist', async () => {
    await seedActor('OWNER');
    signInAs('OWNER');

    const result = await setStaffRoleAction('00000000-0000-4000-8000-0000000000ff', 'STAFF', 'en');
    expect(result.ok).toBe(false);
  });
});

/**
 * The invariant this section is really about is "the store can never be left
 * with nobody who can administer it," and through these actions it is
 * carried entirely by the self-refusal below rather than by the last-owner
 * rule: any caller that gets past `requirePermission('users.manage')` is
 * itself an active OWNER (`auth.ts`'s `jwt` re-reads `active` and `role` on
 * every request), and it can never be its own target — so at least one
 * active owner always survives every call made here.
 *
 * The last-owner rule in `user.service.ts` is the same invariant enforced a
 * layer down, for a caller that is not one of these actions. It is proven
 * where it is reachable — `user.service.test.ts`, including the two-admin
 * race — rather than mimed here against a path that cannot occur.
 */
describe('an owner cannot lock themselves out of their own admin', () => {
  it('refuses to change your own role', async () => {
    await seedActor('OWNER');
    await seedSubject('OWNER'); // another owner exists, so this is not the last-owner rule
    signInAs('OWNER');

    const result = await setStaffRoleAction(ACTOR_ID, 'STAFF', 'en');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('your own role');
    expect((await db.user.findUniqueOrThrow({ where: { id: ACTOR_ID } })).role).toBe('OWNER');
  });

  it('refuses to disable your own account', async () => {
    await seedActor('OWNER');
    await seedSubject('OWNER');
    signInAs('OWNER');

    const result = await setStaffActiveAction(ACTOR_ID, false, 'en');

    expect(result.ok).toBe(false);
    expect((await db.user.findUniqueOrThrow({ where: { id: ACTOR_ID } })).active).toBe(true);
  });

  it('leaves an active owner standing after every change an owner can make', async () => {
    await seedActor('OWNER');
    const second = await seedSubject('OWNER');
    const third = await seedSubject('OWNER');
    signInAs('OWNER');

    // Demote one owner, disable the other: the acting owner is untouchable
    // by their own hand, so the count can never reach zero.
    expect((await setStaffRoleAction(second.id, 'STAFF', 'en')).ok).toBe(true);
    expect((await setStaffActiveAction(third.id, false, 'en')).ok).toBe(true);

    expect(await db.user.count({ where: { role: 'OWNER', active: true } })).toBe(1);
  });
});

describe('credentials and audit', () => {
  it('stores a hash, never the password, and refuses a weak one', async () => {
    await seedActor('OWNER');
    signInAs('OWNER');

    const weak = await createStaffUserAction(newUserForm({ password: 'short1' }), 'en');
    expect(weak.ok).toBe(false);

    const form = newUserForm({ password: 'a-strong-password-9' });
    const created = await createStaffUserAction(form, 'en');
    expect(created.ok).toBe(true);

    const row = await db.user.findUniqueOrThrow({ where: { id: created.data!.id } });
    expect(row.passwordHash).not.toBeNull();
    expect(row.passwordHash).not.toContain('a-strong-password-9');
    expect(await verifyPassword('a-strong-password-9', row.passwordHash!)).toBe(true);
  });

  it('never writes a password or a hash into the audit log', async () => {
    await seedActor('OWNER');
    signInAs('OWNER');

    const form = newUserForm({ password: 'a-strong-password-9' });
    const created = await createStaffUserAction(form, 'en');
    expect(created.ok).toBe(true);

    const entry = await db.auditLog.findFirstOrThrow({ where: { action: 'user.created' } });
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('a-strong-password-9');
    expect(serialized).not.toContain('passwordHash');
    expect(entry.userId).toBe(ACTOR_ID);
    expect(entry.entityType).toBe('User');
    expect(entry.entityId).toBe(created.data!.id);
  });

  it('records who changed whose role, and from what to what', async () => {
    await seedActor('OWNER');
    const subject = await seedSubject('STAFF');
    signInAs('OWNER');

    expect((await setStaffRoleAction(subject.id, 'MANAGER', 'en')).ok).toBe(true);

    const entry = await db.auditLog.findFirstOrThrow({ where: { action: 'user.role_changed' } });
    expect(entry.userId).toBe(ACTOR_ID);
    expect(entry.entityId).toBe(subject.id);
    expect(entry.before).toMatchObject({ role: 'STAFF' });
    expect(entry.after).toMatchObject({ role: 'MANAGER' });
  });

  it('distinguishes disabling from enabling', async () => {
    await seedActor('OWNER');
    const subject = await seedSubject('STAFF');
    signInAs('OWNER');

    await setStaffActiveAction(subject.id, false, 'en');
    await setStaffActiveAction(subject.id, true, 'en');

    expect(await db.auditLog.count({ where: { action: 'user.disabled' } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'user.enabled' } })).toBe(1);
  });

  it('a duplicate email is refused with a message that says so', async () => {
    await seedActor('OWNER');
    signInAs('OWNER');

    const form = newUserForm();
    expect((await createStaffUserAction(form, 'en')).ok).toBe(true);

    const again = await createStaffUserAction(form, 'en');
    expect(again.ok).toBe(false);
    expect(again.error).toContain('already in use');
    expect(await db.user.count({ where: { email: form.email } })).toBe(1);
  });

  it('normalises the email, so casing cannot create a second account', async () => {
    await seedActor('OWNER');
    signInAs('OWNER');

    const form = newUserForm({ email: 'Mixed.Case@Example.COM' });
    expect((await createStaffUserAction(form, 'en')).ok).toBe(true);
    expect(
      (await createStaffUserAction(newUserForm({ email: 'mixed.case@example.com' }), 'en')).ok,
    ).toBe(false);
    expect(await db.user.count({ where: { email: 'mixed.case@example.com' } })).toBe(1);
  });
});

describe('disabling revokes access immediately', () => {
  it('deletes every session the disabled account holds', async () => {
    await seedActor('OWNER');
    const subject = await seedSubject('MANAGER');
    await createDbSession({ userId: subject.id, ip: null, userAgent: null });
    await createDbSession({ userId: subject.id, ip: null, userAgent: null });
    expect(await db.session.count({ where: { userId: subject.id } })).toBe(2);

    signInAs('OWNER');
    expect((await setStaffActiveAction(subject.id, false, 'en')).ok).toBe(true);

    expect(await db.session.count({ where: { userId: subject.id } })).toBe(0);
  });

  it('leaves other accounts’ sessions alone', async () => {
    await seedActor('OWNER');
    const subject = await seedSubject('STAFF');
    const bystander = await seedSubject('STAFF');
    await createDbSession({ userId: subject.id, ip: null, userAgent: null });
    await createDbSession({ userId: bystander.id, ip: null, userAgent: null });

    signInAs('OWNER');
    await setStaffActiveAction(subject.id, false, 'en');

    expect(await db.session.count({ where: { userId: bystander.id } })).toBe(1);
  });
});
