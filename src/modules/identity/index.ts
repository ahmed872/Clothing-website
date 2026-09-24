/**
 * `identity` — users, sessions, roles, permissions, audit log.
 *
 * May depend on: core
 * Must not depend on: every domain module — identity is depended on, it does not depend back
 *
 * P06: real Auth.js-backed authentication, a DB-revocable session on top of
 * it, static role→permission RBAC, and the server-side authorization
 * helpers (`requireUser`/`requirePermission`) every admin boundary calls
 * directly — never a UI-only guard.
 *
 * Other modules import `@/modules/identity`, never a file inside it.
 */

export { handlers, auth, signIn, signOut } from './auth';

export {
  customerHandlers,
  customerAuth,
  customerSignIn,
  customerSignOut,
  CUSTOMER_SESSION_TTL_MS,
} from './customer-auth';

export {
  requireUser,
  requirePermission,
  getOptionalUser,
  requireCustomerUser,
  getOptionalCustomerUser,
  type AuthenticatedUser,
} from './authorize';

export {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  isPermission,
  roleHasPermission,
  isAdminRole,
  type Permission,
} from './permissions';

export {
  hashPassword,
  verifyPassword,
  validatePasswordPolicy,
  passwordPolicySchema,
  validateCustomerPasswordPolicy,
  customerPasswordPolicySchema,
} from './password';

export {
  createUser,
  listStaffUsers,
  getUserByEmail,
  getUserById,
  setUserActive,
  setUserRole,
  verifyAdminCredentials,
  verifyCustomerCredentials,
  type CreateUserInput,
  type VerifyCredentialsResult,
  type VerifyCustomerCredentialsResult,
} from './user.service';

/** Staff administration (P14 §B) — the admin screen at `/admin/users`. */
export {
  STAFF_ROLES,
  isStaffRole,
  listAdminUsers,
  createStaffUser,
  setStaffRole,
  setStaffActive,
  type StaffRole,
  type AdminUserListItem,
  type CreateStaffUserInput,
} from './user.service';

export {
  recordAuditEvent,
  recordAuditEventWithin,
  type AuditAction,
  type AuditEntityType,
  type RecordAuditEventInput,
} from './audit.service';

export { revokeAllUserSessions, revokeDbSession } from './session.service';

export { getPasswordResetRateLimiter, getResendVerificationRateLimiter } from './rate-limiter';
