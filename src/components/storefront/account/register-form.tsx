'use client';

import { useActionState, useId, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';

import type { Locale } from '@/lib/i18n/locales';
import { registerAction, type CustomerRegisterState } from '@/lib/customers/customer-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';

export interface RegisterFormLabels {
  nameLabel: string;
  emailLabel: string;
  phoneLabel: string;
  optional: string;
  passwordLabel: string;
  passwordConfirmationLabel: string;
  passwordHint: string;
  showPassword: string;
  hidePassword: string;
  submit: string;
  submitting: string;
  errors: Record<'validation' | 'email_taken' | 'passwords_do_not_match' | 'generic', string>;
}

const initialState: CustomerRegisterState = { error: null, fieldError: null, values: null };

/**
 * There is no role field anywhere on this form, on the schema it posts to,
 * or on the server action behind it — `registerAction` hard-codes CUSTOMER
 * (P12 §3/§4). The client could send anything in a crafted request and it
 * would still be ignored, because nothing downstream ever reads a `role`
 * key off this input.
 */
export function RegisterForm({ locale, labels }: { locale: Locale; labels: RegisterFormLabels }) {
  const searchParams = useSearchParams();
  const next = searchParams.get('next');
  const boundAction = registerAction.bind(null, locale, next);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const nameId = useId();
  const emailId = useId();
  const phoneId = useId();
  const passwordId = useId();
  const confirmId = useId();
  const errorId = useId();

  const values = state.values ?? { name: '', email: '', phone: '' };

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error ? (
        <Alert variant="error" role="alert" id={errorId}>
          {labels.errors[state.error]}
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId}>{labels.nameLabel}</Label>
        <Input
          key={`name-${values.name}`}
          id={nameId}
          name="name"
          type="text"
          autoComplete="name"
          defaultValue={values.name}
          required
          disabled={isPending}
          aria-invalid={state.error === 'validation' ? true : undefined}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={emailId}>{labels.emailLabel}</Label>
        <Input
          key={`email-${values.email}`}
          id={emailId}
          name="email"
          type="email"
          dir="ltr"
          autoComplete="email"
          defaultValue={values.email}
          required
          disabled={isPending}
          aria-invalid={
            state.error === 'validation' || state.error === 'email_taken' ? true : undefined
          }
          aria-describedby={state.error === 'email_taken' ? errorId : undefined}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={phoneId}>
          {labels.phoneLabel}
          <span className="text-(--color-text-subtle)"> ({labels.optional})</span>
        </Label>
        <Input
          key={`phone-${values.phone}`}
          id={phoneId}
          name="phone"
          type="tel"
          dir="ltr"
          autoComplete="tel"
          defaultValue={values.phone}
          disabled={isPending}
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
