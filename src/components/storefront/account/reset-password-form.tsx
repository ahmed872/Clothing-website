'use client';

import { useActionState, useId, useState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';

import type { Locale } from '@/lib/i18n/locales';
import { resetPasswordAction, type ResetPasswordState } from '@/lib/customers/customer-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';

export interface ResetPasswordFormLabels {
  passwordLabel: string;
  passwordConfirmationLabel: string;
  passwordHint: string;
  showPassword: string;
  hidePassword: string;
  submit: string;
  submitting: string;
  errors: Record<'validation' | 'passwords_do_not_match' | 'invalid' | 'expired' | 'used', string>;
  successTitle: string;
  successBody: string;
  goToLogin: string;
}

const initialState: ResetPasswordState = { done: false, error: null };

/**
 * The raw token lives only in the URL a real emailed link would carry
 * (P13's future delivery) — it is bound into the action here server-side,
 * never re-typed by the customer and never echoed back into the DOM.
 */
export function ResetPasswordForm({
  locale,
  token,
  labels,
}: {
  locale: Locale;
  token: string;
  labels: ResetPasswordFormLabels;
}) {
  const boundAction = resetPasswordAction.bind(null, token);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const passwordId = useId();
  const confirmId = useId();
  const errorId = useId();

  if (state.done) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="success" title={labels.successTitle}>
          {labels.successBody}
        </Alert>
        <Button asChild size="lg">
          <Link href={`/${locale}/account/login`}>{labels.goToLogin}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error ? (
        <Alert variant="error" role="alert" id={errorId}>
          {labels.errors[state.error]}
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={passwordId}>{labels.passwordLabel}</Label>
        <div className="relative">
          <Input
            id={passwordId}
            name="password"
            type={showPassword ? 'text' : 'password'}
            dir="ltr"
            autoComplete="new-password"
            required
            disabled={isPending}
            aria-invalid={state.error === 'validation' ? true : undefined}
            aria-describedby={`${passwordId}-hint`}
            className="pe-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            disabled={isPending}
            aria-label={showPassword ? labels.hidePassword : labels.showPassword}
            aria-pressed={showPassword}
            className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-(--color-text-muted) outline-none transition-colors duration-(--duration-fast) hover:text-(--color-text) focus-visible:ring-2 focus-visible:ring-(--color-ring)/25 disabled:pointer-events-none disabled:opacity-50"
          >
            {showPassword ? (
              <EyeOff className="size-4.5" aria-hidden="true" />
            ) : (
              <Eye className="size-4.5" aria-hidden="true" />
            )}
          </button>
        </div>
        <p id={`${passwordId}-hint`} className="text-caption text-(--color-text-subtle)">
          {labels.passwordHint}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={confirmId}>{labels.passwordConfirmationLabel}</Label>
        <Input
          id={confirmId}
          name="passwordConfirmation"
          type={showPassword ? 'text' : 'password'}
          dir="ltr"
          autoComplete="new-password"
          required
          disabled={isPending}
          aria-invalid={state.error === 'passwords_do_not_match' ? true : undefined}
          aria-describedby={state.error === 'passwords_do_not_match' ? errorId : undefined}
        />
      </div>

      <Button type="submit" size="lg" loading={isPending} disabled={isPending} className="w-full">
        {isPending ? labels.submitting : labels.submit}
      </Button>
    </form>
  );
}
