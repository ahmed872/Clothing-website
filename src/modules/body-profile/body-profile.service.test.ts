import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';
import { registerCustomer } from '@/modules/customers';
import { resetCustomerTables } from '@/modules/customers/testing';

import {
  deleteBodyProfile,
  getBodyProfile,
  saveBodyProfile,
  serializeBodyProfile,
} from './body-profile.service';
import { resetBodyProfileTables } from './testing';

/**
 * The service against a real database: create, read, update, delete, the
 * avatar alongside, the stale-save guard, and — the property the whole
 * module is shaped around — that one customer's calls can only ever reach
 * that customer's own row.
 */

beforeEach(async () => {
  await resetBodyProfileTables();
  await resetCustomerTables();
});

let counter = 0;
async function newCustomer(): Promise<string> {
  counter += 1;
  const { customer } = await registerCustomer({
    email: `body-${counter}-${Date.now()}@example.com`,
    password: 'correct-horse-9',
    name: `Customer ${counter}`,
  });
  return customer.id;
}

const MINIMUM = { gender: 'FEMALE', heightCm: '165', weightKg: '60', waistCm: '72' } as const;

describe('saveBodyProfile / getBodyProfile', () => {
  it('creates a profile from the minimum input and reads it back as numbers', async () => {
    const customerId = await newCustomer();
    expect(await getBodyProfile(customerId)).toBeNull();

    const saved = await saveBodyProfile(customerId, MINIMUM, { expectedUpdatedAt: null });
    expect(saved.gender).toBe('FEMALE');
    expect(saved.measurements).toEqual({
      heightCm: 165,
      weightKg: 60,
      waistCm: 72,
      chestCm: null,
      hipCm: null,
      shoulderCm: null,
      inseamCm: null,
      sleeveLengthCm: null,
      neckCm: null,
    });
    expect(saved.bodyShape).toBeNull();
    expect(saved.avatar.wearsGlasses).toBe(false);

    const read = await getBodyProfile(customerId);
    expect(read).toEqual(saved);
  });

  it('stores one decimal place and derives the body shape from the measurements', async () => {
    const customerId = await newCustomer();
    const saved = await saveBodyProfile(customerId, {
      ...MINIMUM,
      waistCm: '68.25',
      chestCm: '92',
      hipCm: '94',
    });
    expect(saved.measurements.waistCm).toBe(68.3);
    expect(saved.bodyShape).toBe('DEFINED_WAIST');

    const row = await db.bodyProfile.findUniqueOrThrow({ where: { customerId } });
    expect(row.waistCm.toString()).toBe('68.3');
  });

  it('creates and then updates the avatar configuration with the profile', async () => {
    const customerId = await newCustomer();
    const created = await saveBodyProfile(customerId, {
      ...MINIMUM,
      avatar: {
        skinTone: 'MEDIUM_DARK',
        hairStyle: 'COVERED',
        wearsGlasses: true,
        glassesStyle: 'ROUND',
        glassesFrameColor: 'GOLD',
      },
    });
    expect(created.avatar).toEqual({
      skinTone: 'MEDIUM_DARK',
      hairStyle: 'COVERED',
      hairColor: null,
      facialHair: null,
      wearsGlasses: true,
      glassesStyle: 'ROUND',
      glassesFrameColor: 'GOLD',
    });

    const updated = await saveBodyProfile(
      customerId,
      {
        ...MINIMUM,
        avatar: {
          skinTone: 'MEDIUM_DARK',
          hairStyle: 'LONG',
          hairColor: 'BLACK',
          wearsGlasses: false,
          glassesStyle: 'ROUND',
        },
      },
      { expectedUpdatedAt: created.updatedAt },
    );
    expect(updated.avatar).toMatchObject({
      hairStyle: 'LONG',
      hairColor: 'BLACK',
      wearsGlasses: false,
      glassesStyle: null,
      glassesFrameColor: null,
    });
    expect(await db.avatarConfiguration.count()).toBe(1);
  });

  it('updates in place — one profile per customer, a newer version each save', async () => {
    const customerId = await newCustomer();
    const first = await saveBodyProfile(customerId, MINIMUM);
    const second = await saveBodyProfile(
      customerId,
      { ...MINIMUM, weightKg: '61.5', hipCm: '98' },
      { expectedUpdatedAt: first.updatedAt },
    );
    expect(second.measurements.weightKg).toBe(61.5);
    expect(second.measurements.hipCm).toBe(98);
    expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime() - 1);
    expect(second.updatedAt).not.toEqual(first.updatedAt);
    expect(await db.bodyProfile.count({ where: { customerId } })).toBe(1);
  });

  it('can clear an optional measurement again', async () => {
    const customerId = await newCustomer();
    const first = await saveBodyProfile(customerId, { ...MINIMUM, neckCm: '36' });
    const second = await saveBodyProfile(
      customerId,
      { ...MINIMUM, neckCm: '' },
      { expectedUpdatedAt: first.updatedAt },
    );
    expect(second.measurements.neckCm).toBeNull();
  });

  it('never writes an invalid profile — the service validates as well as the action', async () => {
    const customerId = await newCustomer();
    await expect(saveBodyProfile(customerId, { ...MINIMUM, heightCm: '0' })).rejects.toThrow();
    await expect(
      saveBodyProfile(customerId, { ...MINIMUM, customerId: 'someone-else' } as never),
    ).rejects.toThrow();
    expect(await getBodyProfile(customerId)).toBeNull();
  });

  it('refuses a customer that does not exist', async () => {
    await expect(
      saveBodyProfile('00000000-0000-4000-8000-000000000000', MINIMUM),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('stale saves', () => {
  it('refuses a save made against an older version', async () => {
    const customerId = await newCustomer();
    const first = await saveBodyProfile(customerId, MINIMUM, { expectedUpdatedAt: null });
    await saveBodyProfile(
      customerId,
      { ...MINIMUM, weightKg: '62' },
      { expectedUpdatedAt: first.updatedAt },
    );

    await expect(
      saveBodyProfile(
        customerId,
        { ...MINIMUM, weightKg: '99' },
        { expectedUpdatedAt: first.updatedAt },
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await getBodyProfile(customerId))?.measurements.weightKg).toBe(62);
  });

  it('refuses a "first" save when a profile was created in the meantime', async () => {
    const customerId = await newCustomer();
    await saveBodyProfile(customerId, MINIMUM, { expectedUpdatedAt: null });
    await expect(
      saveBodyProfile(customerId, { ...MINIMUM, weightKg: '99' }, { expectedUpdatedAt: null }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses an update to a profile that was deleted in the meantime', async () => {
    const customerId = await newCustomer();
    const first = await saveBodyProfile(customerId, MINIMUM);
    await deleteBodyProfile(customerId);
    await expect(
      saveBodyProfile(customerId, MINIMUM, { expectedUpdatedAt: first.updatedAt }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('lets exactly one of two racing saves of the same version win', async () => {
    const customerId = await newCustomer();
    const first = await saveBodyProfile(customerId, MINIMUM);
    const results = await Promise.allSettled([
      saveBodyProfile(
        customerId,
        { ...MINIMUM, weightKg: '63' },
        { expectedUpdatedAt: first.updatedAt },
      ),
      saveBodyProfile(
        customerId,
        { ...MINIMUM, weightKg: '64' },
        { expectedUpdatedAt: first.updatedAt },
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
});

describe('deleteBodyProfile', () => {
  it('removes the profile and its avatar, and is harmless when there is none', async () => {
    const customerId = await newCustomer();
    await saveBodyProfile(customerId, { ...MINIMUM, avatar: { skinTone: 'LIGHT' } });

    expect(await deleteBodyProfile(customerId)).toBe(true);
    expect(await getBodyProfile(customerId)).toBeNull();
    expect(await db.avatarConfiguration.count()).toBe(0);
    expect(await deleteBodyProfile(customerId)).toBe(false);
  });

  it('goes with the customer when their account is deleted', async () => {
    const customerId = await newCustomer();
    await saveBodyProfile(customerId, MINIMUM);
    const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    await db.user.delete({ where: { id: customer.userId } });
    expect(await db.bodyProfile.count()).toBe(0);
    expect(await db.avatarConfiguration.count()).toBe(0);
  });
});

describe('ownership — one customer can only ever reach their own profile', () => {
  it("reading, saving and deleting as A never touches B's profile", async () => {
    const alice = await newCustomer();
    const bob = await newCustomer();
    await saveBodyProfile(bob, { gender: 'MALE', heightCm: '190', weightKg: '95', waistCm: '94' });
    const bobBefore = await getBodyProfile(bob);

    // Alice has nothing of her own to read — and does not see Bob's.
    expect(await getBodyProfile(alice)).toBeNull();

    // Alice saving creates *her* profile; Bob's is untouched.
    await saveBodyProfile(alice, MINIMUM);
    expect(await getBodyProfile(bob)).toEqual(bobBefore);

    // Alice deleting removes only hers.
    await deleteBodyProfile(alice);
    expect(await getBodyProfile(bob)).toEqual(bobBefore);
    expect(await db.bodyProfile.count()).toBe(1);
  });
});

describe('serializeBodyProfile', () => {
  it('round-trips the version through a string without losing precision', async () => {
    const customerId = await newCustomer();
    const saved = await saveBodyProfile(customerId, MINIMUM);
    const snapshot = serializeBodyProfile(saved);
    expect(typeof snapshot.updatedAt).toBe('string');
    expect(new Date(snapshot.updatedAt).getTime()).toBe(saved.updatedAt.getTime());
    expect(snapshot.measurements).toEqual(saved.measurements);
    // A snapshot is plain data — safe to hand to a client component.
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});
