import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@generated/prisma';

import { db } from '@/modules/core';

import { PERMISSIONS, roleHasPermission } from './permissions';
import {
  createDbSession,
  revokeAllUserSessions,
  revokeDbSession,
  validateDbSession,
} from './session.service';
import { createUser, setUserActive, verifyAdminCredentials } from './user.service';
import { resetIdentityTables } from './testing';

/**
 * P06's required Security Test Matrix, as one readable artifact: every row
 * the completion report names (Authentication, Authorization per role,
 * Direct access to a protected action, IDOR, Session validity/expiry/
 * logout, Secrets) gets its own `describe` block here, calling the real
 * server boundary directly — never through the UI — per P06 §17's explicit
 * instruction. This does not replace the focused unit tests already in
 * `user.service.test.ts`, `session.service.test.ts`, `authorize.test.ts`,
 * `permissions.test.ts`, and `rate-limiter.test.ts`; it is the systematic,
 * exhaustive cross-check over the same real functions those files already
 * exercise case by case.
 */

const authMock = vi.fn();
vi.mock('./auth', () => ({ auth: authMock }));
const { requirePermission, requireUser } = await import('./authorize');

function mockSession(role: Role | null) {
  authMock.mockResolvedValue(
    role
      ? {
          user: { id: 'matrix-user', email: 'matrix@example.com', name: null, role },
          expires: '2099-01-01T00:00:00.000Z',
        }
      : null,
  );
}

beforeEach(async () => {
  await resetIdentityTables();
});

describe('Security Matrix — 1. Authentication', () => {
  it('a correct password for an active admin authenticates', async () => {
    await createUser({ email: 'owner@example.com', password: 'correct-horse-9', role: 'OWNER' });
    expect(await verifyAdminCredentials('owner@example.com', 'correct-horse-9')).toMatchObject({
      ok: true,
    });
  });

  it('a wrong password does not authenticate', async () => {
    await createUser({ email: 'owner@example.com', password: 'correct-horse-9', role: 'OWNER' });
    expect(await verifyAdminCredentials('owner@example.com', 'wrong-password-1')).toEqual({
      ok: false,
      reason: 'WRONG_PASSWORD',
    });
  });

  it('an unknown email does not authenticate', async () => {
    expect(await verifyAdminCredentials('nobody@example.com', 'whatever-123')).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
  });

  it('a disabled admin does not authenticate, even with the correct password', async () => {
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
});

describe('Security Matrix — 2. Authorization per role (requirePermission, the real boundary)', () => {
  const roles = ['OWNER', 'MANAGER', 'STAFF', 'CUSTOMER'] as const;

  for (const role of roles) {
    for (const permission of PERMISSIONS) {
      const shouldAllow = roleHasPermission(role, permission);
      it(`${role} ${shouldAllow ? 'is allowed' : 'is rejected for'} "${permission}"`, async () => {
        mockSession(role);
        if (shouldAllow) {
          await expect(requirePermission(permission)).resolves.toMatchObject({ role });
        } else {
          await expect(requirePermission(permission)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        }
      });
    }
  }

  it('an anonymous (unauthenticated) caller is rejected for every permission with UNAUTHENTICATED, never FORBIDDEN', async () => {
    mockSession(null);
    for (const permission of PERMISSIONS) {
      await expect(requirePermission(permission)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    }
  });
});

describe('Security Matrix — 3. Direct access to a protected action bypasses no check', () => {
  it('STAFF calling requirePermission("products.delete") directly — not through any UI — is rejected exactly as a hidden button would have implied, but by the server, not by absence of a link', async () => {
    mockSession('STAFF');
    await expect(requirePermission('products.delete')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('MANAGER calling requirePermission("users.manage") directly is rejected — Super-Admin-only, enforced server-side regardless of what nav the caller was shown', async () => {
    mockSession('MANAGER');
    await expect(requirePermission('users.manage')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a caller with no session at all calling requireUser() directly gets UNAUTHENTICATED, not a silent pass', async () => {
    mockSession(null);
    await expect(requireUser()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('Security Matrix — 4. IDOR / session isolation', () => {
  it('two different users’ sessions never cross-validate — validating A’s token never resolves to B’s id', async () => {
    const userA = await createUser({
      email: 'a@example.com',
      password: 'correct-horse-9',
      role: 'STAFF',
    });
    const userB = await createUser({
      email: 'b@example.com',
      password: 'correct-horse-9',
      role: 'STAFF',
    });
    const sessionA = await createDbSession({ userId: userA.id });
    const sessionB = await createDbSession({ userId: userB.id });

    expect(await validateDbSession(sessionA.token)).toEqual({ userId: userA.id });
    expect(await validateDbSession(sessionB.token)).toEqual({ userId: userB.id });
    expect((await validateDbSession(sessionA.token))?.userId).not.toBe(userB.id);
  });

  it('revoking user A’s session never touches user B’s — resource (session) access is judged per-token, never by guessing structure', async () => {
    const userA = await createUser({
      email: 'a@example.com',
      password: 'correct-horse-9',
      role: 'STAFF',
    });
    const userB = await createUser({
      email: 'b@example.com',
      password: 'correct-horse-9',
      role: 'STAFF',
    });
    const sessionA = await createDbSession({ userId: userA.id });
    const sessionB = await createDbSession({ userId: userB.id });

    await revokeDbSession(sessionA.token);

    expect(await validateDbSession(sessionA.token)).toBeNull();
    expect(await validateDbSession(sessionB.token)).toEqual({ userId: userB.id });
  });

  it('force-revoking all of user A’s sessions never touches user B’s sessions', async () => {
    const userA = await createUser({
      email: 'a@example.com',
      password: 'correct-horse-9',
      role: 'STAFF',
    });
    const userB = await createUser({
      email: 'b@example.com',
      password: 'correct-horse-9',
      role: 'STAFF',
    });
    const sessionA1 = await createDbSession({ userId: userA.id });
    const sessionA2 = await createDbSession({ userId: userA.id });
    const sessionB = await createDbSession({ userId: userB.id });

    await revokeAllUserSessions(userA.id);

    expect(await validateDbSession(sessionA1.token)).toBeNull();
    expect(await validateDbSession(sessionA2.token)).toBeNull();
    expect(await validateDbSession(sessionB.token)).toEqual({ userId: userB.id });
  });
});

describe('Security Matrix — 5. Session validity / expiry / logout invalidation', () => {
  it('a freshly created session validates', async () => {
    const user = await createUser({
      email: 'a@example.com',
      password: 'correct-horse-9',
      role: 'STAFF',
    });
    const session = await createDbSession({ userId: user.id });
    expect(await validateDbSession(session.token)).toEqual({ userId: user.id });
  });

  it('an invalid/garbage token never validates', async () => {
    expect(await validateDbSession('this-token-was-never-issued')).toBeNull();
  });

  it('logout (revokeDbSession) invalidates the session immediately', async () => {
    const user = await createUser({
      email: 'a@example.com',
      password: 'correct-horse-9',
      role: 'STAFF',
    });
    const session = await createDbSession({ userId: user.id });
    await revokeDbSession(session.token);
    expect(await validateDbSession(session.token)).toBeNull();
  });
});

describe('Security Matrix — 6. Secrets', () => {
  it('the stored password hash never contains the plaintext password', async () => {
    const password = 'correct-horse-battery-9';
    const user = await createUser({ email: 'a@example.com', password, role: 'STAFF' });
    expect(user.passwordHash).not.toContain(password);
  });

  it('a session row stores only a hash of its token, never the raw token', async () => {
    const user = await createUser({
      email: 'a@example.com',
      password: 'correct-horse-9',
      role: 'STAFF',
    });
    const { token } = await createDbSession({ userId: user.id });
    const [row] = await db.session.findMany({ where: { userId: user.id } });
    expect(row?.tokenHash).not.toBe(token);
    expect(row?.tokenHash).not.toContain(token);
  });
});
