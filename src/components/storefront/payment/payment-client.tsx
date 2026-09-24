'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';

import { formatMoney } from '@/modules/core/money';
import type { Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { refreshPaymentAction, startPaymentAction } from '@/lib/payments/payment-actions';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * The pay button, and nothing else.
 *
 * This component cannot make a payment succeed and does not try. It asks the
 * server to open a session, and the server answers with a provider URL to
 * navigate to. It holds no amount of its own — the figure below is a
 * server-supplied prop for the customer to read, and the amount actually
 * charged is recomputed from the stored order every time the action runs
 * (P11 §7/§18).
 *
 * There are no card fields here. The provider hosts the payment page, so
 * card data never touches this application — which is both the safest
 * arrangement and the honest one, since putting a card form in front of a
 * provider that hosts its own would be theatre.
 */

interface PaymentClientProps {
  locale: Locale;
  orderNumber: string;
  amountMinor: number;
  currency: string;
  /** Whether the order can still be paid. Decided on the server. */
  payable: boolean;
  /** Shown after a provider redirect: offers "check again" rather than
   * asserting an outcome the browser cannot know. */
  awaitingConfirmation: boolean;
}

export function PaymentClient({
  locale,
  orderNumber,
  amountMinor,
  currency,
  payable,
  awaitingConfirmation,
}: PaymentClientProps) {
  const t = getDictionary(locale).payment;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [checking, startChecking] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function pay() {
    setError(null);
    startTransition(async () => {
      const result = await startPaymentAction(locale, orderNumber);
      if (result.ok && result.data) {
        // A provider-issued URL, handed back by the server. The browser is
        // sent to the provider and is told nothing else about the payment.
        window.location.assign(result.data.checkoutUrl);
        return;
      }
      setError(result.error ?? t.errorGeneric);
    });
  }

  function check() {
    setError(null);
    startChecking(async () => {
      const result = await refreshPaymentAction(locale, orderNumber);
      if (!result.ok) {
        setError(result.error ?? t.errorGeneric);
        return;
      }
      // Re-render from the server, which is where the answer actually lives.
      router.refresh();
    });
  }

  const busy = pending || checking;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-(--color-text-muted)">{t.amountLabel}</span>
        <span className="text-h5 tabular-nums text-(--color-text)">
          {formatMoney(amountMinor, { currency, locale })}
        </span>
      </div>

      {awaitingConfirmation ? (
        <Alert variant="info" title={t.returnPendingTitle}>
          {t.returnPendingBody}
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="error" title={t.errorGeneric}>
          {error}
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {payable ? (
          <Button onClick={pay} disabled={busy}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <CreditCard className="size-4" aria-hidden="true" />
            )}
            {pending ? t.opening : t.payNow}
          </Button>
        ) : null}

        {awaitingConfirmation ? (
          <Button variant="secondary" onClick={check} disabled={busy}>
            {checking ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-4" aria-hidden="true" />
            )}
            {checking ? t.checking : t.checkAgain}
          </Button>
        ) : null}
      </div>

      {payable ? (
        <p className="flex items-start gap-2 text-caption text-(--color-text-muted)">
          <ShieldCheck className="mt-0.5 size-3.5 flex-none" aria-hidden="true" />
          {t.securedBy}
        </p>
      ) : null}

      {/* Announced politely, so a screen-reader user hears what is happening
          without focus being taken from them (P11 §34). */}
      <p aria-live="polite" className="sr-only">
        {pending ? t.opening : checking ? t.checking : ''}
      </p>
    </div>
  );
}
