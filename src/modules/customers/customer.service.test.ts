import { beforeEach, describe, expect, it } from 'vitest';

import { db, isAppError } from '@/modules/core';
import { resetIdentityTables } from '@/modules/identity/testing';

import {
  registerCustomer,
  resolveCustomerForUser,
  updateCustomerProfile,
} from './customer.service';
import { resetCustomerTables } from './testing';

/**
 * Registration and profile management (P12 §2/§11).
 *
 * The one property worth a dedicated test beyond the happy path: `role` is
 * not a parameter `registerCustomer` accepts at all, so there is no input
 * shape that could ever create anything but a `CUSTOMER` — this is checked
 * by inspecting what the function actually wrote, not by trusting its
 * signature.
 */

beforeEach(async () => {
  await resetCustomerTables();
  await resetIdentityTables();
});

describe('registerCustomer', () => {
  it('creates a User and a Customer row together, hard-coded to role CUSTOMER', async () => {
    const { user, customer } = await registerCustomer({
      email: 'shopper@example.com',
      password: 'correct-horse-9',
      name: 'Shopper One',
      phone: '0501234567',
    });

    expect(user.role).toBe('CUSTOMER');
    expect(user.name).toBe('Shopper One');
    expect(user.passwordHash).not.toContain('correct-horse-9');
    expect(customer.userId).toBe(user.id);
    expect(customer.phone).toBe('0501234567');
  });

  it('defaults to Arabic when no locale is given (the schema default)', async () => {
    const { user } = await registerCustomer({
      email: 'shopper@example.com',
      password: 'correct-horse-9',
      name: 'Shopper',
    });
    expect(user.locale).toBe('AR');
  });

  it('persists the locale the customer actually registered through (P13) — so a later notification is sent in that language, not the schema default regardless of which page was used', async () => {
    const { user } = await registerCustomer({
      email: 'shopper-en@example.com',
      password: 'correct-horse-9',
      name: 'Shopper',
      locale: 'EN',
    });
    expect(user.locale).toBe('EN');
  });

  it('normalizes the email before storing it', async () => {
    const { user } = await registerCustomer({
      email: '  Shopper@Example.COM  ',
      password: 'correct-horse-9',
      name: 'Shopper',
    });
    expect(user.email).toBe('shopper@example.com');
  });

  it('rejects a duplicate email with CONFLICT, revealing only that it is taken', async () => {
    await registerCustomer({
      email: 'shopper@example.com',
      password: 'correct-horse-9',
      name: 'First',
    });

    await expect(
      registerCustomer({
        email: 'shopper@example.com',
        password: 'another-horse-9',
        name: 'Second',
      }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === 'CONFLICT');

    // The first registration stands; the rejected second attempt created
    // nothing.
    expect(await db.user.count({ where: { email: 'shopper@example.com' } })).toBe(1);
  });

  it('two simultaneous registrations for the same email — exactly one wins (P12 §27)', async () => {
    const attempt = () =>
      registerCustomer({ email: 'racer@example.com', password: 'correct-horse-9', name: 'Racer' });

    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(await db.user.count({ where: { email: 'racer@example.com' } })).toBe(1);
  });
});

describe('updateCustomerProfile', () => {
  it('updates the name on User and the phone on Customer in one call', async () => {
    const { user } = await registerCustomer({
      email: 'shopper@example.com',
      password: 'correct-horse-9',
      name: 'Old Name',
      phone: '0500000000',
    });

    const { user: updatedUser, customer: updatedCustomer } = await updateCustomerProfile(user.id, {
      name: 'New Name',
      phone: '0509999999',
    });

    expect(updatedUser.name).toBe('New Name');
    expect(updatedCustomer.phone).toBe('0509999999');
  });

  it('leaves a field unchanged when the input omits it', async () => {
    const { user } = await registerCustomer({
      email: 'shopper@example.com',
      password: 'correct-horse-9',
      name: 'Keep Me',
      phone: '0500000000',
    });

    const { user: updatedUser, customer: updatedCustomer } = await updateCustomerProfile(user.id, {
      phone: '0509999999',
    });

    expect(updatedUser.name).toBe('Keep Me');
    expect(updatedCustomer.phone).toBe('0509999999');
  });

  it('clears the phone when explicitly given null', async () => {
    const { user } = await registerCustomer({
      email: 'shopper@example.com',
      password: 'correct-horse-9',
      name: 'Shopper',
      phone: '0500000000',
    });

    const { customer: updatedCustomer } = await updateCustomerProfile(user.id, { phone: null });
    expect(updatedCustomer.phone).toBeNull();
  });

  it('lazily creates the Customer row for a user who has never shopped before', async () => {
    const { createUser } = await import('@/modules/identity');
    const user = await createUser({
      email: 'lazy@example.com',
      password: 'correct-horse-9',
      role: 'CUSTOMER',
    });
    expect(await db.customer.findUnique({ where: { userId: user.id } })).toBeNull();

    const { customer } = await updateCustomerProfile(user.id, { name: 'Now A Customer' });
    expect(customer.userId).toBe(user.id);
    expect(await resolveCustomerForUser(user.id)).toMatchObject({ id: customer.id });
  });
});
