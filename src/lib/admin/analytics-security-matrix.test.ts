import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@generated/prisma';

import { db, isAppError } from '@/modules/core';
import { resetIdentityTables } from '@/modules/identity/testing';
import { createUser } from '@/modules/identity/user.service';

/**
 * Reporting's authorization matrix (P15), exercised against the boundary
 * itself rather than through the UI.
 *
 * `analytics.read` is the permission that separates "runs the store" from
 * "works in the store": a MANAGER sees the revenue, a STAFF account —
 * which may count stock and move orders along all day — does not. Hiding
 * the Analytics link from their sidebar proves nothing; this proves the
 * server refuses when the function is called anyway.
 */

const authMock = vi.fn();
vi.mock('@/modules/identity/auth', () => ({ auth: authMock }));

const { getSalesReportAction, parseReportRangeDays, REPORT_RANGE_DAYS, DEFAULT_REPORT_RANGE_DAYS } =
  await import('./analytics-actions');

const ACTOR_ID = '00000000-0000-4000-8000-0000000000ab';

function signInAs(role: Role | null): void {
  authMock.mockResolvedValue(
    role
      ? {
          user: { id: ACTOR_ID, email: `${role.toLowerCase()}@example.com`, name: null, role },
          expires: '2099-01-01T00:00:00.000Z',
        }
      : null,
  );
}

async function seedActor(role: Role): Promise<void> {
  const user = await createUser({
    email: `analytics-actor-${role.toLowerCase()}@example.com`,
    password: 'matrix-pass-123',
    role,
  });
  await db.user.update({ where: { id: user.id }, data: { id: ACTOR_ID } });
}

beforeEach(async () => {
  await resetIdentityTables();
  authMock.mockReset();
});

describe('permission matrix', () => {
  const ROLES: Role[] = ['OWNER', 'MANAGER', 'STAFF', 'CUSTOMER'];
  /** Written out literally rather than derived from `ROLE_PERMISSIONS`, so
   * widening who may read the store's revenue takes a deliberate edit in
   * two places. */
  const ALLOWED: Role[] = ['OWNER', 'MANAGER'];

  for (const role of ROLES) {
    const expected = ALLOWED.includes(role);

    it(`getSalesReportAction: ${role} is ${expected ? 'allowed' : 'refused'}`, async () => {
      await seedActor(role);
      signInAs(role);

      if (expected) {
        const report = await getSalesReportAction(30);
        expect(report.revenueByDay).toHaveLength(30);
      } else {
        await expect(getSalesReportAction(30)).rejects.toSatisfy(
          (error: unknown) => isAppError(error) && error.code === 'FORBIDDEN',
        );
      }
    });
  }

  it('a signed-out caller is refused, as UNAUTHENTICATED rather than FORBIDDEN', async () => {
    signInAs(null);
    await expect(getSalesReportAction(30)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === 'UNAUTHENTICATED',
    );
  });
});

describe('the range a URL may ask for', () => {
  it('accepts only the four windows the screen offers', () => {
    for (const days of REPORT_RANGE_DAYS) {
      expect(parseReportRangeDays(String(days))).toBe(days);
    }
  });

  it('falls back to the default for anything else, rather than scanning the table', () => {
    for (const value of ['100000', '-1', '0', 'all', '', null, undefined, '30.5']) {
      expect(parseReportRangeDays(value)).toBe(DEFAULT_REPORT_RANGE_DAYS);
    }
  });
});
