import 'server-only';

import { serverEnv } from '@/modules/core';

import { createMockTryOnProvider } from './mock-provider';
import type { AITryOnProvider } from './provider';
import { parseResultHosts } from './result-url';

/**
 * The single place `AI_TRYON_PROVIDER` is read (clothing P05).
 *
 * `none` — the default — is a real, supported configuration: the fitting
 * room says AI try-on is unavailable and everything else works. `mock` runs
 * the labelled mock adapter, for development and tests. There is no real
 * vendor adapter: none has been selected, and adding one means a file
 * beside `mock-provider.ts`, an enum value in the environment schema, and a
 * branch here — nothing else changes.
 */

export interface TryOnConfig {
  provider: AITryOnProvider;
  /** Hosts a result image may come from (`AI_TRYON_RESULT_HOSTS`). */
  resultHosts: string[];
}

let cached: TryOnConfig | null | undefined;

/** Null when try-on is switched off. Callers must handle that. */
export function getTryOnConfig(): TryOnConfig | null {
  if (cached !== undefined) return cached;
  const env = serverEnv();
  if (env.AI_TRYON_PROVIDER === 'none') {
    cached = null;
    return cached;
  }
  // The environment schema refuses to boot without the secret whenever a
  // provider is enabled; the check is repeated so this can never run with
  // an empty key.
  const secret = env.AI_TRYON_WEBHOOK_SECRET;
  if (!secret) throw new Error('AI_TRYON_WEBHOOK_SECRET is required when AI_TRYON_PROVIDER is set');
  const provider = createMockTryOnProvider({ callbackSecret: secret });
  if (provider.requiresCustomerPhoto) {
    // Customer photo upload (consent, storage, retention) does not exist yet;
    // a provider that needs it cannot be switched on until it does.
    throw new Error(
      `The ${provider.name} try-on provider needs customer photos, which are not supported`,
    );
  }
  cached = { provider, resultHosts: parseResultHosts(env.AI_TRYON_RESULT_HOSTS) };
  return cached;
}

export function isTryOnEnabled(): boolean {
  return getTryOnConfig() !== null;
}

/** Test-only: forces the next call to re-read the environment. */
export function resetTryOnConfigCache(): void {
  cached = undefined;
}
