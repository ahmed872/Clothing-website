import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';

import {
  createUser,
  getUserByEmail,
  getUserById,
  setUserActive,
  setUserRole,
  touchLastLogin,
  verifyAdminCredentials,
  verifyCustomerCredentials,
  listAdminUsers,
  setStaffRole,
  setStaffActive,
} from './user.service';
import { createDbSession } from './session.service';
import { resetIdentityTables } from './testing';

beforeEach(async () => {
  await resetIdentityTables();
});

describe('createUser', () => {
  it('creates a user with a hashed password, never the plaintext', async () => {
    const user = await createUser({
      email: 'Owner@Example.com',
      password: 'correct-horse-9',
      role: 'OWNER',
    });
    expect(user.email).toBe('owner@example.com'); // normalized
    expect(user.passwordHash).not.toContain('correct-horse-9');
    expect(user.active).toBe(true);
  });

  it('rejects a duplicate email', async () => {
    await createUser({ email: 'a@example.com', password: 'correct-horse-9', role: 'STAFF' });
    await expect(
      createUser({ email: 'a@example.com', password: 'another-horse-9', role: 'STAFF' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('getUserByEmail / getUserById', () => {
  it('finds a user case-insensitively by email', async () => {
    const user = await createUser({
      email: 'a@example.com',
      password: 'correct-horse-9',
      role: 'STAFF',
    });
    expect((await getUserByEmail('A@Example.com'))?.id).toBe(user.id);
    expect((await getUserById(user.id))?.email).toBe('a@example.com');
  });

  it('returns null for an unknown user', async () => {
    expect(await getUserByEmail('nobody@example.com')).toBeNull();
    expect(await getUserById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('setUserActive / setUserRole', () => {
  it('disables and re-enables a user', async () => {
    const user = await createUser({
      email: 'a@example.com',
      password: 'correct-horse-9',
      role: 'STAFF',
    });
    const disabled = await setUserActive(user.id, false);
    expect(disabled.active).toBe(false);
    const reenabled = await setUserActive(user.id, true);
    expect(reenabled.active).toBe(true);
  });

  it('changes a role', async () => {
    const user = await createUser({
      email: 'a@example.com',
      password: 'correct-horse-9',
      role: 'STAFF',
    });
    const promoted = await setUserRole(user.id, 'MANAGER');
    expect(promoted.role).toBe('MANAGER');
  });

  it('rejects an id that does not exist', async () => {
    await expect(
      setUserActive('00000000-0000-0000-0000-000000000000', false),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('verifyAdminCredentials', () => {
  it('accepts a matching password for an active admin', async () => {
    await createUser({ email: 'owner@example.com', password: 'correct-horse-9', role: 'OWNER' });
    const result = await verifyAdminCredentials('owner@example.com', 'correct-horse-9');
    expect(result).toMatchObject({ ok: true });
  });

  it('rejects an unknown email', async () => {
    expect(await verifyAdminCredentials('nobody@example.com', 'whatever-12')).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
  });

  it('rejects a wrong password', async () => {
    await createUser({ email: 'owner@example.com', password: 'correct-horse-9', role: 'OWNER' });
    expect(await verifyAdminCredentials('owner@example.com', 'wrong-password-99')).toEqual({
      ok: false,
      reason: 'WRONG_PASSWORD',
    });
  });

  it('rejects a disabled admin even with the correct password', async () => {
    const user = await createUser({
      email: 'owner@example.com',
      password: 'correct-horse-9',
      role: 'OWNER',
    });
    await setUserActive(user.id, false);
    expect(await verifyAdminCredentials('owner@example.com', 'correct-horse-9')).toEqual({
      ok: false,
      reason: 'DISABLED',
    });
  });

  it('rejects a CUSTOMER account — a correct password alone is not an admin credential', async () => {
    await createUser({
      email: 'shopper@example.com',
      password: 'correct-horse-9',
      role: 'CUSTOMER',
    });
    expect(await verifyAdminCredentials('shopper@example.com', 'correct-horse-9')).toEqual({
      ok: false,
      reason: 'NOT_ADMIN',
    });
  });
});

/**
 * The customer twin of `verifyAdminCredentials` (P12 §2) — the mirror-image
 * separation check matters just as much here: an OWNER/MANAGER/STAFF
 * password must never authenticate the storefront's customer session, the
 * same way a customer's password must never authenticate the admin one.
 */
describe('verifyCustomerCredentials', () => {
  it('accepts a matching password for an active customer', async () => {
    await createUser({
      email: 'shopper@example.com',
      password: 'correct-horse-9',
      role: 'CUSTOMER',
    });
    expect(await verifyCustomerCredentials('shopper@example.com', 'correct-horse-9')).toMatchObject(
      { ok: true },
    );
  });

  it('rejects an unknown email', async () => {
    expect(await verifyCustomerCredentials('nobody@example.com', 'whatever-12')).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
  });

  it('rejects a wrong password', async () => {
    await createUser({
      email: 'shopper@example.com',
      password: 'correct-horse-9',
      role: 'CUSTOMER',
    });
    expect(await verifyCustomerCredentials('shopper@example.com', 'wrong-password-99')).toEqual({
      ok: false,
      reason: 'WRONG_PASSWORD',
    });
  });

  it('rejects a disabled customer even with the correct password', async () => {
    const user = await createUser({
      email: 'shopper@example.com',
      password: 'correct-horse-9',
      role: 'CUSTOMER',
    });
    await setUserActive(user.id, false);
    expect(await verifyCustomerCredentials('shopper@example.com', 'correct-horse-9')).toEqual({
      ok: false,
      reason: 'DISABLED',
    });
  });

  it('rejects an admin account — the mirror of admin login rejecting a customer', async () => {
    await createUser({ email: 'owner@example.com', password: 'correct-horse-9', role: 'OWNER' });
    expect(await verifyCustomerCredentials('owner@example.com', 'correct-horse-9')).toEqual({
      ok: false,
      reason: 'NOT_CUSTOMER',
    });
  });

  for (const role of ['MANAGER', 'STAFF'] as const) {
    it(`rejects a ${role} account the same way`, async () => {
      await createUser({
        email: `${role.toLowerCase()}@example.com`,
        password: 'correct-horse-9',
        role,
      });
      expect(
        await verifyCustomerCredentials(`${role.toLowerCase()}@example.com`, 'correct-horse-9'),
      ).toEqual({ ok: false, reason: 'NOT_CUSTOMER' });
    });
  }

  it('rejects an account with no password set, rather than throwing', async () => {
    const user = await createUser({
      email: 'shopper@example.com',
      password: 'correct-horse-9',
      role: 'CUSTOMER',
    });
    await db.user.update({ where: { id: user.id }, data: { passwordHash: null } });
    expect(await verifyCustomerCredentials('shopper@example.com', 'correct-horse-9')).toEqual({
      ok: false,
      reason: 'NO_PASSWORD',
    });
  });
});

describe('touchLastLogin', () => {
  it('sets lastLoginAt', async () => {
    const user = await createUser({
      email: 'a@example.com',
      password: 'correct-horse-9',
      role: 'STAFF',
    });
    expect(user.lastLoginAt).toBeNull();
    await touchLastLogin(user.id);
    expect((await getUserById(user.id))?.lastLoginAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Staff administration (P14 §B)
// ---------------------------------------------------------------------------

describe('listAdminUsers', () => {
  it('returns every staff account and no customer', async () => {
    await createUser({ email: 'owner@example.com', password: 'correct-horse-9', role: 'OWNER' });
    await createUser({ email: 'staff@example.com', password: 'correct-horse-9', role: 'STAFF' });
    await createUser({
      email: 'shopper@example.com',
      password: 'correct-horse-9',
      role: 'CUSTOMER',
    });

    const listed = await listAdminUsers();

    expect(listed.map((user) => user.email).sort()).toEqual([
      'owner@example.com',
      'staff@example.com',
    ]);
  });

  it('never selects the password hash', async () => {
    await createUser({ email: 'owner@example.com', password: 'correct-horse-9', role: 'OWNER' });
    const [listed] = await listAdminUsers();
    expect(listed).toBeDefined();
    expect('passwordHash' in listed!).toBe(false);
    expect(JSON.stringify(listed)).not.toContain('correct-horse-9');
  });
});

describe('setStaffRole / setStaffActive', () => {
  async function seed() {
    const owner = await createUser({
      email: 'owner@example.com',
      password: 'correct-horse-9',
      role: 'OWNER',
    });
    const staff = await createUser({
      email: 'staff@example.com',
      password: 'correct-horse-9',
      role: 'STAFF',
    });
    return { owner, staff };
  }

  it('changes a role and reports what it was', async () => {
    const { owner, staff } = await seed();
    const result = await setStaffRole({ actorId: owner.id, userId: staff.id, role: 'MANAGER' });
    expect(result.previousRole).toBe('STAFF');
    expect(result.user.role).toBe('MANAGER');
  });

  it('refuses a target that is not a staff account', async () => {
    const { owner } = await seed();
    const customer = await createUser({
      email: 'shopper@example.com',
      password: 'correct-horse-9',
      role: 'CUSTOMER',
    });
    await expect(
      setStaffRole({ actorId: owner.id, userId: customer.id, role: 'OWNER' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', details: { reasonCode: 'not_a_staff_account' } });
    await expect(
      setStaffActive({ actorId: owner.id, userId: customer.id, active: false }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses an unknown user', async () => {
    const { owner } = await seed();
    await expect(
      setStaffRole({
        actorId: owner.id,
        userId: '00000000-0000-0000-0000-000000000000',
        role: 'STAFF',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses to change the acting admin’s own row', async () => {
    const { owner } = await seed();
    await expect(
      setStaffRole({ actorId: owner.id, userId: owner.id, role: 'STAFF' }),
    ).rejects.toMatchObject({ details: { reasonCode: 'cannot_change_own_role' } });
    await expect(
      setStaffActive({ actorId: owner.id, userId: owner.id, active: false }),
    ).rejects.toMatchObject({ details: { reasonCode: 'cannot_disable_self' } });
  });

  it('refuses to demote or disable the last active owner', async () => {
    const { owner, staff } = await seed();

    // `staff` acts here only to reach the rule: the *permission* to do this
    // is checked a layer up (`user-actions.ts`), and this is the service's
    // own invariant, which must hold for any caller.
    await expect(
      setStaffRole({ actorId: staff.id, userId: owner.id, role: 'MANAGER' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reasonCode: 'last_owner' } });
    await expect(
      setStaffActive({ actorId: staff.id, userId: owner.id, active: false }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reasonCode: 'last_owner' } });

    const unchanged = await getUserById(owner.id);
    expect(unchanged?.role).toBe('OWNER');
    expect(unchanged?.active).toBe(true);
  });

  it('a disabled owner does not count as an owner', async () => {
    const { owner, staff } = await seed();
    const second = await createUser({
      email: 'owner2@example.com',
      password: 'correct-horse-9',
      role: 'OWNER',
    });
    await db.user.update({ where: { id: second.id }, data: { active: false } });

    await expect(
      setStaffRole({ actorId: staff.id, userId: owner.id, role: 'STAFF' }),
    ).rejects.toMatchObject({ details: { reasonCode: 'last_owner' } });
  });

  it('promoting to OWNER is never blocked by the last-owner rule', async () => {
    const { owner, staff } = await seed();
    const promoted = await setStaffRole({ actorId: owner.id, userId: staff.id, role: 'OWNER' });
    expect(promoted.user.role).toBe('OWNER');
  });

  it('disabling deletes that account’s sessions and nobody else’s', async () => {
    const { owner, staff } = await seed();
    await createDbSession({ userId: staff.id });
    await createDbSession({ userId: staff.id });
    await createDbSession({ userId: owner.id });

    const result = await setStaffActive({ actorId: owner.id, userId: staff.id, active: false });

    expect(result.revokedSessions).toBe(2);
    expect(await db.session.count({ where: { userId: staff.id } })).toBe(0);
    expect(await db.session.count({ where: { userId: owner.id } })).toBe(1);
  });

  it('re-enabling touches no session', async () => {
    const { owner, staff } = await seed();
    await db.user.update({ where: { id: staff.id }, data: { active: false } });
    const result = await setStaffActive({ actorId: owner.id, userId: staff.id, active: true });
    expect(result.revokedSessions).toBe(0);
    expect(result.user.active).toBe(true);
  });

  /**
   * The race the row lock exists for. Two admins demote two *different*
   * owners at the same moment: without serialising on the owner set, each
   * transaction counts the other's owner as still active, both commit, and
   * the store is left with nobody who can administer it. Exactly one of
   * these must fail.
   */
  it('two concurrent demotions cannot both remove the last two owners', async () => {
    const actor = await createUser({
      email: 'actor@example.com',
      password: 'correct-horse-9',
      role: 'STAFF',
    });
    const ownerA = await createUser({
      email: 'a@example.com',
      password: 'correct-horse-9',
      role: 'OWNER',
    });
    const ownerB = await createUser({
      email: 'b@example.com',
      password: 'correct-horse-9',
      role: 'OWNER',
    });

    const results = await Promise.allSettled([
      setStaffRole({ actorId: actor.id, userId: ownerA.id, role: 'STAFF' }),
      setStaffRole({ actorId: actor.id, userId: ownerB.id, role: 'STAFF' }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect(await db.user.count({ where: { role: 'OWNER', active: true } })).toBe(1);
  });

  it('two concurrent disables cannot both remove the last two owners', async () => {
    const actor = await createUser({
      email: 'actor@example.com',
      password: 'correct-horse-9',
      role: 'STAFF',
    });
    const ownerA = await createUser({
      email: 'a@example.com',
      password: 'correct-horse-9',
      role: 'OWNER',
    });
    const ownerB = await createUser({
      email: 'b@example.com',
      password: 'correct-horse-9',
      role: 'OWNER',
    });

    const results = await Promise.allSettled([
      setStaffActive({ actorId: actor.id, userId: ownerA.id, active: false }),
      setStaffActive({ actorId: actor.id, userId: ownerB.id, active: false }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.user.count({ where: { role: 'OWNER', active: true } })).toBe(1);
  });
});
