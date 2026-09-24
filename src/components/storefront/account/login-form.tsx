'use client';

import { useActionState, useId, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';

import type { Locale } from '@/lib/i18n/locales';
import { customerLoginAction, type CustomerLoginState } from '@/lib/customers/customer-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';

export interface LoginFormLabels {
  emailLabel: string;
  passwordLabel: string;
  showPassword: string;
  hidePassword: string;
  submit: string;
  submitting: string;
  errors: Record<'validation' | 'rate_limited' | 'invalid_credentials', string>;
}

const initialState: CustomerLoginState = { error: null, email: null };

/**
 * The storefront twin of `admin/login-form.tsx` — same
 * `useActionState`-driven pending/error/disabled shape, same
 * three-generic-reasons error surface, same real submission path a
 * JS-disabled browser would also post to. What differs is the action it
 * calls (`customerLoginAction`, the separate customer Auth.js instance) and
 * the `next` destination, read from the URL and validated server-side
 * inside that action before it is ever used as a redirect target.
 */
export function LoginForm({ locale, labels }: { locale: Locale; labels: LoginFormLabels }) {
  const searchParams = useSearchParams();
  const next = searchParams.get('next');
  const boundAction = customerLoginAction.bind(null, locale, next);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error ? (
        <Alert variant="error" role="alert" id={errorId}>
          {labels.errors[state.error]}
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={emailId}>{labels.emailLabel}</Label>
        <Input
          key={state.email ?? ''}
          id={emailId}
          name="email"
          type="email"
          dir="ltr"
          autoComplete="email"
          defaultValue={state.email ?? ''}
          required
          disabled={isPending}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? errorId : undefined}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={passwordId}>{labels.passwordLabel}</Label>
        <div className="relative">
          <Input
            id={passwordId}
            name="password"
            type={showPassword ? 'text' : 'password'}
            dir="ltr"
            autoComplete="current-password"
            required
            disabled={isPending}
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? errorId : undefined}
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
      </div>

      <Button type="submit" size="lg" loading={isPending} disabled={isPending} className="w-full">
        {isPending ? labels.submitting : labels.submit}
      </Button>
    </form>
  );
}
