'use client';

import { useActionState, useId } from 'react';

import { forgotPasswordAction, type ForgotPasswordState } from '@/lib/customers/customer-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';

export interface ForgotPasswordFormLabels {
  emailLabel: string;
  submit: string;
  submitting: string;
  errorValidation: string;
  successTitle: string;
  successBody: string;
}

const initialState: ForgotPasswordState = { submitted: false, error: null };

/**
 * Always ends the same way regardless of whether the email exists (P12
 * §13/§21): the success panel below is the *only* outcome a submitted form
 * ever shows, and `forgotPasswordAction` itself never distinguishes the two
 * cases in what it returns.
 */
export function ForgotPasswordForm({ labels }: { labels: ForgotPasswordFormLabels }) {
  const [state, formAction, isPending] = useActionState(forgotPasswordAction, initialState);
  const emailId = useId();
  const errorId = useId();

  if (state.submitted) {
    return (
      <Alert variant="success" title={labels.successTitle}>
        {labels.successBody}
      </Alert>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error ? (
        <Alert variant="error" role="alert" id={errorId}>
          {labels.errorValidation}
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={emailId}>{labels.emailLabel}</Label>
        <Input
          id={emailId}
          name="email"
          type="email"
          dir="ltr"
          autoComplete="email"
          required
          disabled={isPending}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? errorId : undefined}
        />
      </div>

      <Button type="submit" size="lg" loading={isPending} disabled={isPending} className="w-full">
        {isPending ? labels.submitting : labels.submit}
      </Button>
    </form>
  );
}
