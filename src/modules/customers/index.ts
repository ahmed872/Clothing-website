/**
 * `customers` — customer accounts, registration, profile, and the email
 * verification / password reset token domain.
 *
 * May depend on: core, identity, catalog
 * Must not depend on: orders, payments
 *
 * P09 built only the piece the cart needed: resolving the `Customer` row
 * behind a signed-in `User`. P12 completes the account itself — real
 * registration (`User` + `Customer` created together, not lazily), profile
 * updates, and the token machinery email verification and password reset
 * both need. Addresses, wishlist and reviews remain a later phase's; their
 * schema exists but nothing here builds a UI or service on top of it yet.
 *
 * Other modules import `@/modules/customers`, never a file inside it.
 */

export {
  resolveCustomerForUser,
  findCustomerForUser,
  registerCustomer,
  updateCustomerProfile,
  type RegisterCustomerInput,
  type RegisteredCustomer,
  type UpdateCustomerProfileInput,
} from './customer.service';

/** Admin (P15) — the read-only customer directory. Deliberately no writes:
 * `customers.read` is the only customer permission there is, and every
 * write an admin might want belongs to another owner (see
 * `customer-admin.service.ts`). */
export {
  listCustomersForAdmin,
  getCustomerForAdmin,
  type CustomerListQuery,
  type CustomerListItem,
  type CustomerDetail,
  type CustomerAddressView,
  type CustomerSort,
  type PaginatedCustomers,
} from './customer-admin.service';

export {
  queueEmailVerificationEmail,
  createEmailVerificationToken,
  verifyEmailToken,
  createPasswordResetToken,
  requestPasswordReset,
  resetPasswordWithToken,
  isEmailVerified,
  type CreatedToken,
  type VerifyEmailResult,
  type ResetPasswordResult,
} from './token.service';
