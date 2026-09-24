import { parseClientEnv, type ClientEnv } from './env.schema';

/**
 * Client-safe environment.
 *
 * Every value here is public by definition — Next.js inlines `NEXT_PUBLIC_*`
 * into the browser bundle. Nothing sensitive may ever be added to this file.
 *
 * The variables are referenced by their full literal names because Next.js
 * replaces them at build time; `process.env[someVariable]` would not be
 * substituted and would read as undefined in the browser.
 */

let cached: ClientEnv | undefined;

export function clientEnv(): ClientEnv {
  if (cached) return cached;

  const result = parseClientEnv({
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_DEFAULT_LOCALE: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
  });

  if (!result.success) {
    throw new Error(result.message);
  }

  cached = result.data;
  return cached;
}
