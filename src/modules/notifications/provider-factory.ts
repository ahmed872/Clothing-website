import 'server-only';

import { serverEnv } from '@/modules/core';

import { consoleEmailProvider } from './console-provider';
import { smtpEmailProvider } from './smtp-provider';
import { testEmailProvider } from './test-provider';
import type { EmailProviderAdapter } from './provider';

/**
 * The single place `EMAIL_PROVIDER` is read (P13 §1) — every other file
 * (the dispatcher, the templates, the route handler) works against
 * `EmailProviderAdapter`. There is no `if (provider === 'smtp')` anywhere
 * else in the codebase, mirroring `payments/provider-factory.ts` exactly.
 */

let cached: EmailProviderAdapter | undefined;

export function getEmailProvider(): EmailProviderAdapter {
  if (cached) return cached;

  switch (serverEnv().EMAIL_PROVIDER) {
    case 'smtp':
      cached = smtpEmailProvider;
      break;
    case 'test':
      cached = testEmailProvider;
      break;
    case 'console':
      cached = consoleEmailProvider;
      break;
  }
  return cached;
}

/** Test-only: forces the next call to re-read the environment. */
export function resetEmailProviderCache(): void {
  cached = undefined;
}
