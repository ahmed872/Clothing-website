import 'server-only';

import { AppError, serverEnv } from '@/modules/core';

import { hostedCheckoutProvider } from './hosted-checkout-provider';
import type { PaymentProviderAdapter } from './provider';

/**
 * The single place `PAYMENT_PROVIDER` is read (P11 §5).
 *
 * Every other file — the payment service, the order domain, the webhook
 * route, the UI — works against `PaymentProviderAdapter`. There is no
 * `if (provider === 'tap')` anywhere else in the codebase, and adding a
 * vendor means adding a branch here and a file beside it.
 */

let cached: PaymentProviderAdapter | null | undefined;

/** `null` when payment is switched off. Callers must handle that: an
 * environment with no provider is a supported configuration, not an error
 * state, and checkout says so rather than offering a button that cannot
 * work. */
export function getPaymentProvider(): PaymentProviderAdapter | null {
  if (cached !== undefined) return cached;
  cached = serverEnv().PAYMENT_PROVIDER === 'hosted_checkout' ? hostedCheckoutProvider : null;
  return cached;
}

/** The same thing, for paths that have already established payment is
 * available and want a typed adapter rather than a null check. */
export function requirePaymentProvider(): PaymentProviderAdapter {
  const provider = getPaymentProvider();
  if (!provider) {
    throw new AppError('CONFLICT', {
      internalMessage: 'A payment was requested while PAYMENT_PROVIDER is "none"',
      details: { reasonCode: 'payments_disabled' },
    });
  }
  return provider;
}

export function isPaymentEnabled(): boolean {
  return getPaymentProvider() !== null;
}

/** Test-only: forces the next call to re-read the environment, for tests
 * that toggle `PAYMENT_PROVIDER` mid-suite. */
export function resetPaymentProviderCache(): void {
  cached = undefined;
}
