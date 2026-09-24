'use client';

import { useActionState, useEffect, useId, useRef } from 'react';

import type { Locale } from '@/lib/i18n/locales';
import { updateProfileAction, type UpdateProfileData } from '@/lib/customers/customer-actions';
import type { ActionResult } from '@/lib/admin/action-result';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { toast } from '@/components/ui/toast';

export interface ProfileFormLabels {
  nameLabel: string;
  emailLabel: string;
  phoneLabel: string;
  optional: string;
  emailReadOnlyNote: string;
  saveChanges: string;
  saving: string;
  updatedToast: string;
}

const initialState: ActionResult<UpdateProfileData> = { ok: true };

/**
 * Name and phone go through the real server action; email renders as a
 * disabled field with an explanatory note rather than an editable one —
 * there is no "save" path for it at all in P12, so there is nothing here
 * that could look editable and silently fail (P12 §11).
 */
export function ProfileForm({
  locale,
  email,
  initialName,
  initialPhone,
  labels,
}: {
  locale: Locale;
  email: string;
  initialName: string;
  initialPhone: string;
  labels: ProfileFormLabels;
}) {
  const boundAction = updateProfileAction.bind(null, locale);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);
  const nameId = useId();
  const emailId = useId();
  const phoneId = useId();
  const errorId = useId();

  // `initialState.data` is undefined, so this only fires once a real
  // submission has actually resolved successfully — never on first render.
  const announced = useRef(false);
  useEffect(() => {
    if (state.ok && state.data && !announced.current) {
      announced.current = true;
      toast({ title: labels.updatedToast, variant: 'success' });
    }
    if (!state.ok) announced.current = false;
  }, [state, labels.updatedToast]);

  const name = state.ok && state.data ? state.data.name : initialName;
  const phone = state.ok && state.data ? (state.data.phone ?? '') : initialPhone;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {!state.ok && state.error ? (
        <Alert variant="error" role="alert" id={errorId}>
          {state.error}
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId}>{labels.nameLabel}</Label>
        <Input
          key={name}
          id={nameId}
          name="name"
          type="text"
          autoComplete="name"
          defaultValue={name}
          required
          disabled={isPending}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={emailId}>{labels.emailLabel}</Label>
        <Input id={emailId} type="email" dir="ltr" value={email} disabled readOnly />
        <p className="text-caption text-(--color-text-subtle)">{labels.emailReadOnlyNote}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={phoneId}>
          {labels.phoneLabel}
          <span className="text-(--color-text-subtle)"> ({labels.optional})</span>
        </Label>
        <Input
          key={phone}
          id={phoneId}
          name="phone"
          type="tel"
          dir="ltr"
          autoComplete="tel"
          defaultValue={phone}
          disabled={isPending}
        />
      </div>

      <Button type="submit" loading={isPending} disabled={isPending} className="self-start">
        {isPending ? labels.saving : labels.saveChanges}
      </Button>
    </form>
  );
}
