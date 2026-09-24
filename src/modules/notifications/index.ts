/**
 * `notifications` — the email provider boundary and template rendering.
 *
 * May depend on: core, settings
 * Must not depend on: orders, catalog, identity, customers — callers pass
 * data in. This module never resolves a `userId` to a `User` row, never
 * mints a token, and never decides who a message goes to beyond the
 * `to`/`toName` a caller already supplies — see `templates.ts`'s own
 * comment for why (`EmailCopy` is fully pre-translated, for the same
 * reason). `src/lib/notifications/email-dispatcher.ts` is the composition
 * point that crosses `identity`/`customers`/`core`/this module together,
 * the same pattern `src/lib/customers/customer-identity.ts` already
 * established in P12.
 *
 * Implementation lands in P13. Other modules import `@/modules/notifications`,
 * never a file inside it.
 */

export {
  EmailSendError,
  isEmailSendError,
  type EmailMessage,
  type EmailProviderAdapter,
  type EmailSendFailureKind,
  type EmailSendResult,
} from './provider';

export { getEmailProvider, resetEmailProviderCache } from './provider-factory';

export {
  buildPasswordResetEmail,
  buildVerificationEmail,
  type BuildEmailInput,
  type EmailCopy,
} from './templates';
