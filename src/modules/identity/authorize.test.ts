import { describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('./auth', () => ({ auth: authMock }));

// Imported after the mock so `authorize.ts`'s `auth` binding resolves to
// `authMock` — this is the module's actual server boundary: `requireUser`/
// `requirePermission` are what every admin Server Action and Route Handler
// calls directly, so their authorization decision is tested here without
// going through a real cookie/JWT round-trip (that end-to-end path — real
// login, real session cookie, a direct server-action call bypassing the
// UI — is covered by Task 22's security test matrix).
const { requireUser, requirePermission, getOptionalUser } = await import('./authorize');

function mockSession(
  user: { id: string; email: string; name: string | null; role: string } | null,
) {
  authMock.mockResolvedValue(user ? { user, expires: '2099-01-01T00:00:00.000Z' } : null);
}

describe('requireUser', () => {
  it('returns the authenticated user for a valid session', async () => {
    mockSession({ id: 'u1', email: 'owner@example.com', name: 'Owner', role: 'OWNER' });
    await expect(requireUser()).resolves.toMatchObject({ id: 'u1', role: 'OWNER' });
  });

  it('throws UNAUTHENTICATED when there is no session', async () => {
    mockSession(null);
    await expect(requireUser()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('throws UNAUTHENTICATED when the session carries no role (malformed/invalidated token)', async () => {
    authMock.mockResolvedValue({
      user: { id: 'u1', email: 'a@example.com' },
      expires: '2099-01-01T00:00:00.000Z',
    });
    await expect(requireUser()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('requirePermission', () => {
  it('allows a role that has the permission', async () => {
    mockSession({ id: 'u1', email: 'manager@example.com', name: null, role: 'MANAGER' });
    await expect(requirePermission('products.delete')).resolves.toMatchObject({ role: 'MANAGER' });
  });

  it('rejects a role that lacks the permission with FORBIDDEN, not UNAUTHENTICATED', async () => {
    mockSession({ id: 'u1', email: 'staff@example.com', name: null, role: 'STAFF' });
    await expect(requirePermission('products.delete')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects an unauthenticated caller with UNAUTHENTICATED, not FORBIDDEN', async () => {
    mockSession(null);
    await expect(requirePermission('products.delete')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('users.manage is OWNER-only — a MANAGER is rejected', async () => {
    mockSession({ id: 'u1', email: 'manager@example.com', name: null, role: 'MANAGER' });
    await expect(requirePermission('users.manage')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('getOptionalUser', () => {
  it('returns the user when signed in', async () => {
    mockSession({ id: 'u1', email: 'owner@example.com', name: null, role: 'OWNER' });
    expect(await getOptionalUser()).toMatchObject({ id: 'u1' });
  });

  it('returns null instead of throwing when signed out', async () => {
    mockSession(null);
    expect(await getOptionalUser()).toBeNull();
  });
});
