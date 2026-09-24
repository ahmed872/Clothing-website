import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';

import {
  createDbSession,
  revokeAllUserSessions,
  revokeDbSession,
  validateDbSession,
} from './session.service';
import { createUser } from './user.service';
import { resetIdentityTables } from './testing';

beforeEach(async () => {
  await resetIdentityTables();
});

async function makeUser() {
  return createUser({ email: 'owner@example.com', password: 'correct-horse-9', role: 'OWNER' });
}

describe('createDbSession / validateDbSession', () => {
  it('creates a session row and validates its raw token', async () => {
    const user = await makeUser();
    const { token } = await createDbSession({
      userId: user.id,
      ip: '1.2.3.4',
      userAgent: 'vitest',
    });
    const validated = await validateDbSession(token);
    expect(validated).toEqual({ userId: user.id });
  });

  it('never stores the raw token — only its hash', async () => {
    const user = await makeUser();
    const { token } = await createDbSession({ userId: user.id });
    const rows = await db.session.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(token);
    expect(rows[0]!.tokenHash).not.toContain(token);
  });

  it('rejects an unknown token', async () => {
    expect(await validateDbSession('not-a-real-token')).toBeNull();
  });

  it('rejects an expired session', async () => {
    const user = await makeUser();
    const { token } = await createDbSession({ userId: user.id });
    // Force the row into the past directly — createDbSession always issues
    // a future expiry, so this is the only way to exercise the expiry path.
    await db.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await validateDbSession(token)).toBeNull();
  });
});

describe('revokeDbSession', () => {
  it('logout: invalidates exactly the session named by its token', async () => {
    const user = await makeUser();
    const a = await createDbSession({ userId: user.id });
    const b = await createDbSession({ userId: user.id });

    await revokeDbSession(a.token);

    expect(await validateDbSession(a.token)).toBeNull();
    expect(await validateDbSession(b.token)).toEqual({ userId: user.id });
  });
});

describe('revokeAllUserSessions', () => {
  it('force-logout: invalidates every session for the user', async () => {
    const user = await makeUser();
    const a = await createDbSession({ userId: user.id });
    const b = await createDbSession({ userId: user.id });

    await revokeAllUserSessions(user.id);

    expect(await validateDbSession(a.token)).toBeNull();
    expect(await validateDbSession(b.token)).toBeNull();
  });
});
