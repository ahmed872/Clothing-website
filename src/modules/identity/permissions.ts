import type { Role } from '@generated/prisma';

/**
 * Role-Based Access Control.
 *
 * `isAdmin === true` is explicitly not a permission system (P06 §5) — every
 * authorization decision in this codebase checks a specific permission
 * against the caller's role, never a coarse "is this an admin" flag. The
 * permission list below is deliberately short: each one exists because a
 * real P07+ feature needs exactly that granularity (e.g. `orders.read` vs
 * `orders.update` because a Staff role can see orders without being able to
 * change them) — not "every table gets a permission" speculatively.
 *
 * `CUSTOMER` carries no admin permissions at all; it isn't an admin role.
 */
export const PERMISSIONS = [
  'products.read',
  'products.create',
  'products.update',
  'products.delete',
  'categories.manage',
  'brands.manage',
  'inventory.read',
  'inventory.adjust',
  'orders.read',
  'orders.update',
  'customers.read',
  'discounts.manage',
  'content.manage',
  'settings.manage',
  'analytics.read',
  'users.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

const ALL_PERMISSIONS = PERMISSIONS;

/** Everything except `users.manage` — a store manager runs the store's
 * catalog/orders/content/settings day to day, but granting/revoking other
 * admins' access is reserved for Super Admin (OWNER) alone. */
const MANAGER_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter((p) => p !== 'users.manage');

/** Day-to-day operational access: look things up, adjust stock, move an
 * order forward — no delete, no store configuration, no other users. */
const STAFF_PERMISSIONS: Permission[] = [
  'products.read',
  'inventory.read',
  'inventory.adjust',
  'orders.read',
  'orders.update',
  'customers.read',
];

/**
 * The one source of truth for "what can this role do." Static, not
 * database-driven — a dynamic per-user permission grant system is real
 * scope a later phase can add if the store ever needs it; P06 needs
 * exactly four fixed roles to work correctly end to end.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: ALL_PERMISSIONS,
  MANAGER: MANAGER_PERMISSIONS,
  STAFF: STAFF_PERMISSIONS,
  CUSTOMER: [],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Whether `role` may reach the admin area at all — every admin role, and
 * only admin roles. A disabled/customer account never gets here regardless
 * of this check (see `authorize.ts` for the account-status gate). */
export function isAdminRole(role: Role): boolean {
  return role !== 'CUSTOMER';
}
