import type { PaymentAttemptStatus } from '@generated/prisma';

import { getDictionary } from '@/lib/i18n/dictionary';
import type { Locale } from '@/lib/i18n/locales';
import type { StatusTone } from '@/lib/orders/order-labels';

/**
 * Attempt-status labels and tone.
 *
 * `Record<PaymentAttemptStatus, …>` on both maps, so adding a status to the
 * schema without translating it stops compiling. Colour is never the only
 * signal — every badge that uses these carries its text (P11 §34).
 */

export function paymentAttemptLabel(status: PaymentAttemptStatus, locale: Locale): string {
  const t = getDictionary(locale).payment;
  const labels: Record<PaymentAttemptStatus, string> = {
    CREATED: t.statusCreated,
    REQUIRES_ACTION: t.statusRequiresAction,
    PENDING: t.statusPending,
    SUCCEEDED: t.statusSucceeded,
    FAILED: t.statusFailed,
    CANCELLED: t.statusCancelled,
    EXPIRED: t.statusExpired,
  };
  return labels[status];
}

export function paymentAttemptTone(status: PaymentAttemptStatus): StatusTone {
  const tones: Record<PaymentAttemptStatus, StatusTone> = {
    CREATED: 'warning',
    REQUIRES_ACTION: 'warning',
    PENDING: 'info',
    SUCCEEDED: 'success',
    FAILED: 'error',
    CANCELLED: 'neutral',
    EXPIRED: 'neutral',
  };
  return tones[status];
}
