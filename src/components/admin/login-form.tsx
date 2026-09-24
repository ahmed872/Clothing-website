'use client';

import { useActionState, useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { loginAction, type LoginActionState, type LoginErrorReason } from '@/lib/admin/actions';

export interface LoginFormLabels {
  emailLabel: string;
  emailPlaceholder: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  showPassword: string;
  hidePassword: string;
  submit: string;
  submitting: string;
  errors: Record<LoginErrorReason, string>;
}

const initialState: LoginActionState = { error: null, email: null };

/**
 * Every state P06 §10 asks for: HTML5 `required`/`type="email"` give
 * instant client-side validation feedback with zero JS, `useActionState`
 * drives the pending/disabled/error states from the one real submission
 * path (`loginAction`, which is also exactly what a JS-disabled browser
 * posts to — no separate "fake" client-only validation path to keep in
 * sync). The error text never says which of email/password/rate-limit was
 * wrong beyond the three buckets `loginAction` already collapsed it to.
 */
export function LoginForm({ labels }: { labels: LoginFormLabels }) {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error ? (
        <Alert
          variant="error"
          role="alert"
          id={errorId}
          className="animate-in fade-in-0 slide-in-from-top-1"
        >
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
          autoComplete="email"
          placeholder={labels.emailPlaceholder}
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
            autoComplete="current-password"
            placeholder={labels.passwordPlaceholder}
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

      <Button
        type="submit"
        size="lg"
        loading={isPending}
        disabled={isPending}
        className="mt-1 w-full"
      >
        {isPending ? labels.submitting : labels.submit}
      </Button>
    </form>
  );
}
