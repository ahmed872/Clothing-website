import { describe, expect, it } from 'vitest';

import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  isAdminRole,
  isPermission,
  roleHasPermission,
} from './permissions';

describe('roleHasPermission', () => {
  it('OWNER (Super Admin) has every permission', () => {
    for (const permission of PERMISSIONS) {
      expect(roleHasPermission('OWNER', permission)).toBe(true);
    }
  });

  it('MANAGER has every permission except users.manage', () => {
    expect(roleHasPermission('MANAGER', 'products.delete')).toBe(true);
    expect(roleHasPermission('MANAGER', 'settings.manage')).toBe(true);
    expect(roleHasPermission('MANAGER', 'users.manage')).toBe(false);
  });

  it('STAFF only has the limited operational set', () => {
    expect(roleHasPermission('STAFF', 'orders.read')).toBe(true);
    expect(roleHasPermission('STAFF', 'inventory.adjust')).toBe(true);
    expect(roleHasPermission('STAFF', 'products.delete')).toBe(false);
    expect(roleHasPermission('STAFF', 'users.manage')).toBe(false);
    expect(roleHasPermission('STAFF', 'settings.manage')).toBe(false);
  });

  it('CUSTOMER has no admin permissions at all', () => {
    for (const permission of PERMISSIONS) {
      expect(roleHasPermission('CUSTOMER', permission)).toBe(false);
    }
  });
});

describe('isAdminRole', () => {
  it('is true for every admin role', () => {
    expect(isAdminRole('OWNER')).toBe(true);
    expect(isAdminRole('MANAGER')).toBe(true);
    expect(isAdminRole('STAFF')).toBe(true);
  });

  it('is false for CUSTOMER', () => {
    expect(isAdminRole('CUSTOMER')).toBe(false);
  });
});

describe('isPermission', () => {
  it('accepts every declared permission', () => {
    for (const permission of PERMISSIONS) expect(isPermission(permission)).toBe(true);
  });

  it('rejects an arbitrary string', () => {
    expect(isPermission('products.frobnicate')).toBe(false);
  });
});

describe('ROLE_PERMISSIONS shape', () => {
  it('covers exactly the four schema roles', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(['CUSTOMER', 'MANAGER', 'OWNER', 'STAFF']);
  });

  it('every permission granted to a role is a declared permission', () => {
    for (const permissions of Object.values(ROLE_PERMISSIONS)) {
      for (const permission of permissions) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });
});
