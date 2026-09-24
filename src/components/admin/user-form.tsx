'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { createStaffUserAction } from '@/lib/admin/user-actions';
import type { StaffRoleValue } from '@/components/admin/users-table';
import type { Locale } from '@/lib/i18n/locales';

/**
 * The client-side mirror of `createStaffSchema` in `user-actions.ts` — the
 * same rules, for instant feedback. It is not the enforcement: the action
 * re-parses every field server-side, because this file ships to the browser
 * and anything in it can be edited or skipped entirely.
 */
const userFormSchema = z.object({
  email: z.string().trim().min(1).max(254).email(),
  name: z.string().trim().max(120),
  password: z
    .string()
    .min(12)
    .max(128)
    .regex(/[A-Za-z]/)
    .regex(/[0-9]/),
  role: z.enum(['OWNER', 'MANAGER', 'STAFF']),
});

type UserFormValues = z.infer<typeof userFormSchema>;

export interface UserFormLabels {
  emailLabel: string;
  nameLabel: string;
  nameOptional: string;
  passwordLabel: string;
  passwordHelp: string;
  showPassword: string;
  hidePassword: string;
  roleLabel: string;
  roles: Record<StaffRoleValue, string>;
  roleHelp: Record<StaffRoleValue, string>;
  submit: string;
  submitting: string;
  cancel: string;
  requiredField: string;
  created: string;
  invalidEmail: string;
}

const ROLE_ORDER: StaffRoleValue[] = ['OWNER', 'MANAGER', 'STAFF'];

export function UserForm({ locale, labels }: { locale: Locale; labels: UserFormLabels }) {
  const router = useRouter();
  const emailId = useId();
  const nameId = useId();
  const passwordId = useId();
  const roleId = useId();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema),
    // `STAFF` rather than the most powerful role: creating an account should
    // require deliberately choosing to hand out more, never less.
    defaultValues: { email: '', name: '', password: '', role: 'STAFF' },
  });

  // `useWatch`, not `watch()` — the same choice `attribute-definitions-manager.tsx`
  // makes, and the one the React Compiler lint rule requires: `watch()`
  // returns a fresh function the compiler cannot memoize safely.
  const role = useWatch({ control, name: 'role' });

  async function onSubmit(values: UserFormValues): Promise<void> {
    setFormError(null);
    const result = await createStaffUserAction(
      { email: values.email, name: values.name, password: values.password, role: values.role },
      locale,
    );
    if (!result.ok) {
      setFormError(result.error ?? null);
      return;
    }
    toast({ title: labels.created, variant: 'success' });
    router.push('/admin/users');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-xl flex-col gap-5">
      {formError ? (
        <Alert variant="error" role="alert">
          {formError}
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={emailId}>{labels.emailLabel}</Label>
        <Input
          id={emailId}
          type="email"
          dir="ltr"
          autoComplete="off"
          {...register('email')}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? `${emailId}-error` : undefined}
        />
        {errors.email ? (
          <p id={`${emailId}-error`} className="text-small text-(--color-error)">
            {labels.invalidEmail}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId}>
          {labels.nameLabel}{' '}
          <span className="font-normal text-(--color-text-muted)">({labels.nameOptional})</span>
        </Label>
        <Input id={nameId} autoComplete="off" {...register('name')} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={passwordId}>{labels.passwordLabel}</Label>
        <div className="relative">
          <Input
            id={passwordId}
            type={showPassword ? 'text' : 'password'}
            // `new-password` (not `off`): it asks a password manager to
            // offer a generated one rather than autofilling the signed-in
            // admin's own credentials into a form that creates someone
            // else's account.
            autoComplete="new-password"
            className="pe-11"
            {...register('password')}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={`${passwordId}-help`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="absolute inset-y-0 end-0 flex items-center px-3 text-(--color-text-muted) hover:text-(--color-text) focus-visible:ring-2 focus-visible:ring-(--color-ring)/25 focus-visible:outline-none"
            aria-label={showPassword ? labels.hidePassword : labels.showPassword}
            aria-pressed={showPassword}
          >
            {showPassword ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
        <p
          id={`${passwordId}-help`}
          className={
            errors.password
              ? 'text-small text-(--color-error)'
              : 'text-caption text-(--color-text-muted)'
          }
        >
          {labels.passwordHelp}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={roleId}>{labels.roleLabel}</Label>
        <Controller
          control={control}
          name="role"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id={roleId}>
                <SelectValue>{labels.roles[field.value]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ROLE_ORDER.map((option) => (
                  <SelectItem key={option} value={option}>
                    {labels.roles[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <p className="text-caption text-(--color-text-muted)">{labels.roleHelp[role]}</p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={isSubmitting}>
          {isSubmitting ? labels.submitting : labels.submit}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push('/admin/users')}>
          {labels.cancel}
        </Button>
      </div>
    </form>
  );
}
