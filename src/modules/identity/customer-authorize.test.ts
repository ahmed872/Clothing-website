import { describe, expect, it, vi } from 'vitest';

/**
 * The customer twin of `authorize.test.ts`, against the *other* Auth.js
 * instance (P12 §16). Mocking `./customer-auth`'s `customerAuth` export
 * mirrors exactly how `authorize.test.ts` mocks `./auth`'s `auth` export —
 * `requireCustomerUser`/`getOptionalCustomerUser` are what every storefront
 * account page and server action calls, so their decision is tested at that
 * real boundary.
 *
 * The one property `authorize.test.ts` has no need to state, because there
 * is only one instance on the admin side, is the one P12 adds an entire new
 * surface for: a session minted by the *admin* instance must not satisfy
 * the *customer* gate, and vice versa. `requireCustomerUser` reads only
 * `customerAuth()`'s own session — the two instances share no cookie name,
 * so this isn't a runtime scenario that can occur through the browser, but
 * asserting it at the function level pins the invariant in code rather than
 * leaving it as an inference from "they use different cookies."
 */

const customerAuthMock = vi.fn();
vi.mock('./customer-auth', () => ({ customerAuth: customerAuthMock }));
const { requireCustomerUser, getOptionalCustomerUser } = await import('./authorize');

function mockCustomerSession(
  user: { id: string; email: string; name: string | null; role: string } | null,
) {
  customerAuthMock.mockResolvedValue(user ? { user, expires: '2099-01-01T00:00:00.000Z' } : null);
}

describe('requireCustomerUser', () => {
  it('returns the authenticated customer for a valid session', async () => {
    mockCustomerSession({
      id: 'c1',
      email: 'shopper@example.com',
      name: 'Shopper',
      role: 'CUSTOMER',
    });
    await expect(requireCustomerUser()).resolves.toMatchObject({ id: 'c1', role: 'CUSTOMER' });
  });

  it('throws UNAUTHENTICATED when there is no session', async () => {
    mockCustomerSession(null);
    await expect(requireCustomerUser()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('throws UNAUTHENTICATED for a session carrying an admin role — an admin session must not pass the customer gate', async () => {
    mockCustomerSession({ id: 'a1', email: 'owner@example.com', name: 'Owner', role: 'OWNER' });
    await expect(requireCustomerUser()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  for (const role of ['MANAGER', 'STAFF']) {
    it(`throws UNAUTHENTICATED for a ${role} session the same way`, async () => {
      mockCustomerSession({ id: 'a2', email: 'staff@example.com', name: null, role });
      await expect(requireCustomerUser()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });
  }

  it('throws UNAUTHENTICATED when the session carries no role at all', async () => {
    customerAuthMock.mockResolvedValue({
      user: { id: 'c1', email: 'shopper@example.com' },
      expires: '2099-01-01T00:00:00.000Z',
    });
    await expect(requireCustomerUser()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('getOptionalCustomerUser', () => {
  it('returns the customer when signed in', async () => {
    mockCustomerSession({ id: 'c1', email: 'shopper@example.com', name: null, role: 'CUSTOMER' });
    expect(await getOptionalCustomerUser()).toMatchObject({ id: 'c1' });
  });

  it('returns null instead of throwing when signed out', async () => {
    mockCustomerSession(null);
    expect(await getOptionalCustomerUser()).toBeNull();
  });

  it('returns null for an admin session rather than treating it as a customer', async () => {
    mockCustomerSession({ id: 'a1', email: 'owner@example.com', name: null, role: 'OWNER' });
    expect(await getOptionalCustomerUser()).toBeNull();
  });
});
