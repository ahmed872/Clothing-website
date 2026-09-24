/**
 * `core` — the only module every other module may depend on.
 *
 * It owns cross-cutting foundations: database access, environment, errors and
 * money. It must never contain domain logic (catalog, orders, pricing, ...) —
 * that belongs to the module that owns it.
 *
 * This file is the module's public surface. Other modules import
 * `@/modules/core`, never a file inside it.
 */

export { db } from './db';
export { serverEnv } from './env';
export { clientEnv } from './env.client';
export {
  parseClientEnv,
  parseServerEnv,
  assertNoPublicSecrets,
  clientEnvSchema,
  serverEnvSchema,
  type ClientEnv,
  type ServerEnv,
  type ParseResult,
} from './env.schema';
export {
  AppError,
  ERROR_CODES,
  isAppError,
  toAppError,
  type ErrorCode,
  type UserMessage,
} from './errors';
export {
  DEFAULT_CURRENCY,
  DEFAULT_MINOR_UNIT_EXPONENT,
  applyPercentage,
  assertMinor,
  formatMoney,
  fromMinor,
  sumMinor,
  toMinor,
  type Locale,
} from './money';
