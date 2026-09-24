import 'server-only';

import { parseServerEnv, type ServerEnv } from './env.schema';

/**
 * Server environment access.
 *
 * The `server-only` import is the enforcement mechanism, not a convention: if
 * any client component ever imports this module (directly or transitively),
 * the build fails instead of shipping secrets to the browser.
 */

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;

  const result = parseServerEnv(process.env);
  if (!result.success) {
    // Fail fast and loudly at boot rather than at the first query.
    throw new Error(result.message);
  }

  cached = result.data;
  return cached;
}
