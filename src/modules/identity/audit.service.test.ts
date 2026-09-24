import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';

import { recordAuditEvent } from './audit.service';
import { createUser } from './user.service';
import { resetIdentityTables } from './testing';

beforeEach(async () => {
  await resetIdentityTables();
});

describe('recordAuditEvent', () => {
  it('records a login success against the user', async () => {
    const user = await createUser({
      email: 'owner@example.com',
      password: 'correct-horse-9',
      role: 'OWNER',
    });
    await recordAuditEvent({ action: 'auth.login.success', userId: user.id, ip: '1.2.3.4' });

    const rows = await db.auditLog.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'auth.login.success',
      entityType: 'User',
      ip: '1.2.3.4',
    });
  });

  it('records a failed login with no user row (unknown email) without a foreign key', async () => {
    await recordAuditEvent({
      action: 'auth.login.failure',
      userId: null,
      before: { reason: 'NOT_FOUND' },
    });
    const rows = await db.auditLog.findMany({ where: { action: 'auth.login.failure' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBeNull();
    expect(rows[0]!.before).toMatchObject({ reason: 'NOT_FOUND' });
  });

  it('records a role change with before/after snapshots', async () => {
    const user = await createUser({
      email: 'owner@example.com',
      password: 'correct-horse-9',
      role: 'STAFF',
    });
    await recordAuditEvent({
      action: 'user.role_changed',
      userId: user.id,
      before: { role: 'STAFF' },
      after: { role: 'MANAGER' },
    });

    const [row] = await db.auditLog.findMany({ where: { action: 'user.role_changed' } });
    expect(row?.before).toEqual({ role: 'STAFF' });
    expect(row?.after).toEqual({ role: 'MANAGER' });
  });
});
