import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@generated/prisma';

import { db } from '@/modules/core';
import { registerCustomer } from '@/modules/customers';
import { resetCustomerTables } from '@/modules/customers/testing';
import { resetBodyProfileTables } from '@/modules/body-profile/testing';

/**
 * The body-profile actions as a signed-in customer (or nobody) reaches them:
 * the real actions, the real database, and only the customer session
 * mocked — `customerAuth`, the same seam `cart-security.test.ts` uses.
 *
 * Every IDOR and mass-assignment attempt here is made the only way an
 * attacker could: by adding fields to the form. There is no action argument
 * that takes an id, which is the point — these tests prove the form fields
 * are ignored, not merely that a parameter is checked.
 */

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

// `vi.hoisted`: `@/modules/customers` (imported statically above, for the
// test's own setup) reaches `customer-auth` while this file's imports are
// still being evaluated, so the mock's function has to exist before them.
const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/identity/customer-auth', () => ({ customerAuth: authMock }));

const { saveBodyProfileAction, deleteBodyProfileAction } = await import('./body-profile-actions');
const { revalidatePath } = await import('next/cache');
const { getBodyProfile } = await import('@/modules/body-profile');

function signInAs(userId: string | null, role: Role = 'CUSTOMER'): void {
  authMock.mockResolvedValue(
    userId
      ? {
          user: { id: userId, email: `${userId}@example.com`, name: null, role },
          expires: '2099-01-01T00:00:00.000Z',
        }
      : null,
  );
}

let counter = 0;
async function newCustomer(): Promise<{ userId: string; customerId: string }> {
  counter += 1;
  const { user, customer } = await registerCustomer({
    email: `action-${counter}-${Date.now()}@example.com`,
    password: 'correct-horse-9',
    name: `Shopper ${counter}`,
  });
  return { userId: user.id, customerId: customer.id };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const MINIMUM = {
  gender: 'MALE',
  heightCm: '177',
  weightKg: '82',
  waistCm: '88',
  expectedUpdatedAt: '',
};

const IDLE = { status: 'idle' } as const;

beforeEach(async () => {
  await resetBodyProfileTables();
  await resetCustomerTables();
  authMock.mockReset();
});

describe('unauthenticated', () => {
  it('cannot save — nothing is written', async () => {
    signInAs(null);
    const state = await saveBodyProfileAction('en', IDLE, form(MINIMUM));
    expect(state).toEqual({ status: 'error', formError: 'session_expired' });
    expect(await db.bodyProfile.count()).toBe(0);
  });

  it('cannot delete', async () => {
    const victim = await newCustomer();
    signInAs(victim.userId);
    await saveBodyProfileAction('en', IDLE, form(MINIMUM));

    signInAs(null);
    expect(await deleteBodyProfileAction('en')).toEqual({ ok: false, error: 'session_expired' });
    expect(await db.bodyProfile.count()).toBe(1);
  });

  it('a staff session is not a customer session', async () => {
    const admin = await db.user.create({
      data: { email: `owner-${Date.now()}@example.com`, role: 'OWNER' },
    });
    signInAs(admin.id, 'OWNER');
    const state = await saveBodyProfileAction('en', IDLE, form(MINIMUM));
    expect(state.status).toBe('error');
    expect(await db.bodyProfile.count()).toBe(0);
    await db.user.delete({ where: { id: admin.id } });
  });
});

describe('the signed-in customer', () => {
  it('saves, and the returned snapshot is their own profile', async () => {
    const me = await newCustomer();
    signInAs(me.userId);

    const state = await saveBodyProfileAction(
      'ar',
      IDLE,
      form({
        ...MINIMUM,
        hipCm: '٩٨',
        skinTone: 'MEDIUM',
        wearsGlasses: 'true',
        glassesStyle: 'ROUND',
        glassesFrameColor: 'BLACK',
      }),
    );
    expect(state.status).toBe('saved');
    expect(state.profile?.measurements).toMatchObject({ heightCm: 177, hipCm: 98 });
    expect(state.profile?.avatar).toMatchObject({
      skinTone: 'MEDIUM',
      wearsGlasses: true,
      glassesStyle: 'ROUND',
    });

    const stored = await getBodyProfile(me.customerId);
    expect(stored?.measurements.waistCm).toBe(88);
  });

  it('records that a profile was saved, never what is in it', async () => {
    const me = await newCustomer();
    signInAs(me.userId);
    await saveBodyProfileAction('en', IDLE, form({ ...MINIMUM, neckCm: '39' }));

    const events = await db.auditLog.findMany({
      where: { action: 'customer.body_profile_saved', userId: me.userId },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.userId).toBe(me.userId);
    expect(events[0]?.before).toBeNull();
    expect(events[0]?.after).toBeNull();
  });

  it('updates with the version it was shown, and is refused with a stale one', async () => {
    const me = await newCustomer();
    signInAs(me.userId);
    const first = await saveBodyProfileAction('en', IDLE, form(MINIMUM));
    const version = first.profile!.updatedAt;

    const second = await saveBodyProfileAction(
      'en',
      IDLE,
      form({ ...MINIMUM, weightKg: '80', expectedUpdatedAt: version }),
    );
    expect(second.status).toBe('saved');

    // The same (now old) version again — another tab's view of the profile.
    const stale = await saveBodyProfileAction(
      'en',
      IDLE,
      form({ ...MINIMUM, weightKg: '99', expectedUpdatedAt: version }),
    );
    expect(stale).toEqual({ status: 'error', formError: 'stale' });
    expect((await getBodyProfile(me.customerId))?.measurements.weightKg).toBe(80);

    const garbage = await saveBodyProfileAction(
      'en',
      IDLE,
      form({ ...MINIMUM, expectedUpdatedAt: 'not-a-date' }),
    );
    expect(garbage).toEqual({ status: 'error', formError: 'stale' });
  });

  it('deletes their own profile', async () => {
    const me = await newCustomer();
    signInAs(me.userId);
    await saveBodyProfileAction('en', IDLE, form(MINIMUM));
    expect(await deleteBodyProfileAction('en')).toEqual({ ok: true });
    expect(await getBodyProfile(me.customerId)).toBeNull();
    // Deleting again is fine — there is simply nothing left.
    expect(await deleteBodyProfileAction('en')).toEqual({ ok: true });
  });

  it('revalidates only a real locale path — the bound locale is client input too', async () => {
    const me = await newCustomer();
    signInAs(me.userId);
    vi.mocked(revalidatePath).mockClear();

    await saveBodyProfileAction('ar', IDLE, form(MINIMUM));
    expect(revalidatePath).toHaveBeenCalledWith('/ar/account/body-profile');

    vi.mocked(revalidatePath).mockClear();
    const forged = '../admin' as unknown as Parameters<typeof deleteBodyProfileAction>[0];
    expect(await deleteBodyProfileAction(forged)).toEqual({ ok: true });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('validation', () => {
  it('returns a code per field, and writes nothing', async () => {
    const me = await newCustomer();
    signInAs(me.userId);
    const state = await saveBodyProfileAction(
      'en',
      IDLE,
      form({ gender: 'MALE', heightCm: '0', weightKg: '', waistCm: '88.555', chestCm: '999' }),
    );
    expect(state).toEqual({
      status: 'error',
      formError: 'invalid',
      fieldErrors: {
        heightCm: 'too_small',
        weightKg: 'required',
        waistCm: 'invalid_number',
        chestCm: 'too_large',
      },
    });
    expect(await db.bodyProfile.count()).toBe(0);
  });

  it('rejects a value outside a closed list', async () => {
    const me = await newCustomer();
    signInAs(me.userId);
    const state = await saveBodyProfileAction(
      'en',
      IDLE,
      form({ ...MINIMUM, gender: 'ADMIN', skinTone: 'GREEN', hairStyle: '<script>' }),
    );
    expect(state.fieldErrors).toEqual({
      gender: 'invalid_option',
      skinTone: 'invalid_option',
      hairStyle: 'invalid_option',
    });
    expect(await db.bodyProfile.count()).toBe(0);
  });
});

describe('ownership — IDOR and mass assignment', () => {
  it("a customer cannot write into another customer's profile by naming them in the form", async () => {
    const victim = await newCustomer();
    signInAs(victim.userId);
    await saveBodyProfileAction('en', IDLE, form({ ...MINIMUM, heightCm: '190' }));
    const victimProfile = await db.bodyProfile.findUniqueOrThrow({
      where: { customerId: victim.customerId },
      include: { avatar: true },
    });

    const attacker = await newCustomer();
    signInAs(attacker.userId);
    const state = await saveBodyProfileAction(
      'en',
      IDLE,
      form({
        ...MINIMUM,
        heightCm: '150',
        customerId: victim.customerId,
        bodyProfileId: victimProfile.id,
        avatarConfigurationId: victimProfile.avatar!.id,
        id: victimProfile.id,
        userId: victim.userId,
        bodyShape: 'STRAIGHT',
      }),
    );

    // The save went to the attacker's own, new profile…
    expect(state.status).toBe('saved');
    expect((await getBodyProfile(attacker.customerId))?.measurements.heightCm).toBe(150);
    // …and the victim's is exactly as it was.
    expect((await getBodyProfile(victim.customerId))?.measurements.heightCm).toBe(190);
    const after = await db.bodyProfile.findUniqueOrThrow({ where: { id: victimProfile.id } });
    expect(after.updatedAt).toEqual(victimProfile.updatedAt);
    // The derived field was not taken from the form either.
    expect((await getBodyProfile(attacker.customerId))?.bodyShape).toBeNull();
  });

  it("a customer cannot read another customer's profile through the save response", async () => {
    const victim = await newCustomer();
    signInAs(victim.userId);
    await saveBodyProfileAction('en', IDLE, form({ ...MINIMUM, heightCm: '190', neckCm: '41' }));

    const attacker = await newCustomer();
    signInAs(attacker.userId);
    const state = await saveBodyProfileAction(
      'en',
      IDLE,
      form({ ...MINIMUM, customerId: victim.customerId }),
    );
    expect(state.profile?.measurements.heightCm).toBe(177);
    expect(state.profile?.measurements.neckCm).toBeNull();
    expect(JSON.stringify(state)).not.toContain(victim.customerId);
  });

  it("a customer cannot delete another customer's profile", async () => {
    const victim = await newCustomer();
    signInAs(victim.userId);
    await saveBodyProfileAction('en', IDLE, form(MINIMUM));

    const attacker = await newCustomer();
    signInAs(attacker.userId);
    expect(await deleteBodyProfileAction('en')).toEqual({ ok: true });
    expect(await getBodyProfile(victim.customerId)).not.toBeNull();
  });

  it('the snapshot a client receives carries no internal ids', async () => {
    const me = await newCustomer();
    signInAs(me.userId);
    const state = await saveBodyProfileAction('en', IDLE, form(MINIMUM));
    const row = await db.bodyProfile.findUniqueOrThrow({
      where: { customerId: me.customerId },
      include: { avatar: true },
    });
    const serialized = JSON.stringify(state);
    for (const id of [me.customerId, me.userId, row.id, row.avatar!.id]) {
      expect(serialized).not.toContain(id);
    }
  });
});
