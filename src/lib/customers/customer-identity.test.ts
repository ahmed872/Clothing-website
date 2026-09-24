import { describe, expect, it, vi } from 'vitest';

/**
 * `getOptionalCustomerAccount`/`requireCustomerAccount` compose three other
 * boundaries: `getOptionalCustomerUser` (proves who is signed in),
 * `getUserById` (a fresh read of their display data — `name`/`email` come
 * from here, deliberately not from the session's own JWT claims, since a
 * profile update does not necessarily rotate the session cookie), and
 * `resolveCustomerForUser` (their `Customer` row). Mocking all three at
 * their own module barrels tests exactly that composition, the same way
 * `authorize.test.ts` mocks `./auth` to test `requireUser` at its real
 * boundary.
 */

const getOptionalCustomerUserMock = vi.fn();
const getUserByIdMock = vi.fn();
vi.mock('@/modules/identity', () => ({
  getOptionalCustomerUser: getOptionalCustomerUserMock,
  getUserById: getUserByIdMock,
}));

const resolveCustomerForUserMock = vi.fn();
vi.mock('@/modules/customers', () => ({ resolveCustomerForUser: resolveCustomerForUserMock }));

const { getOptionalCustomerAccount, requireCustomerAccount } = await import('./customer-identity');

describe('getOptionalCustomerAccount', () => {
  it('returns null when signed out, without ever resolving a Customer row or a User row', async () => {
    getOptionalCustomerUserMock.mockResolvedValue(null);
    expect(await getOptionalCustomerAccount()).toBeNull();
    expect(resolveCustomerForUserMock).not.toHaveBeenCalled();
    expect(getUserByIdMock).not.toHaveBeenCalled();
  });

  it('composes the session identity with a fresh User row and their Customer row when signed in', async () => {
    getOptionalCustomerUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'stale-session-email@example.com',
      name: 'Stale Session Name',
      role: 'CUSTOMER',
    });
    getUserByIdMock.mockResolvedValue({
      id: 'user-1',
      email: 'shopper@example.com',
      name: 'Shopper',
    });
    resolveCustomerForUserMock.mockResolvedValue({ id: 'customer-1', userId: 'user-1' });

    const account = await getOptionalCustomerAccount();
    // The name/email come from the fresh `getUserById` read, not the
    // session's own (potentially stale) claims — this is the property that
    // matters, not merely that some name/email came back.
    expect(account).toEqual({
      userId: 'user-1',
      customerId: 'customer-1',
      email: 'shopper@example.com',
      name: 'Shopper',
    });
    expect(getUserByIdMock).toHaveBeenCalledWith('user-1');
    expect(resolveCustomerForUserMock).toHaveBeenCalledWith('user-1');
  });

  it('returns null if the User row is gone even though the session still names an id', async () => {
    getOptionalCustomerUserMock.mockResolvedValue({
      id: 'deleted-user',
      email: 'gone@example.com',
      name: null,
      role: 'CUSTOMER',
    });
    getUserByIdMock.mockResolvedValue(null);

    expect(await getOptionalCustomerAccount()).toBeNull();
  });
});

describe('requireCustomerAccount', () => {
  it('returns the account when signed in', async () => {
    getOptionalCustomerUserMock.mockResolvedValue({
      id: 'user-2',
      email: 'shopper2@example.com',
      name: null,
      role: 'CUSTOMER',
    });
    getUserByIdMock.mockResolvedValue({ id: 'user-2', email: 'shopper2@example.com', name: null });
    resolveCustomerForUserMock.mockResolvedValue({ id: 'customer-2', userId: 'user-2' });

    await expect(requireCustomerAccount()).resolves.toMatchObject({ customerId: 'customer-2' });
  });

  it('throws AppError("UNAUTHENTICATED") when signed out, rather than returning null', async () => {
    getOptionalCustomerUserMock.mockResolvedValue(null);
    await expect(requireCustomerAccount()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
