'use server';

import { revalidatePath } from 'next/cache';
import { AuthError, CredentialsSignin } from 'next-auth';
import { z } from 'zod';

import { isAppError, toAppError } from '@/modules/core';
import { customerSignIn, customerSignOut, customerPasswordPolicySchema } from '@/modules/identity';
import {
  registerCustomer,
  updateCustomerProfile,
  requestPasswordReset,
  resetPasswordWithToken,
  queueEmailVerificationEmail,
} from '@/modules/customers';
import {
  recordAuditEvent,
  getPasswordResetRateLimiter,
  getResendVerificationRateLimiter,
} from '@/modules/identity';
import type { Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import type { ActionResult } from '@/lib/admin/action-result';

import { requireCustomerAccount } from './customer-identity';
import { safeAccountRedirect } from './safe-redirect';

/**
 * Every storefront customer-identity server action: register, sign in, sign
 * out, profile update, and the password-reset request/completion pair.
 *
 * The pattern throughout is the one `checkout-actions.ts`/P06's
 * `loginAction` already established: a plain `ActionResult`/`useActionState`
 * shape, never a thrown error crossing back to the client, and every
 * mutating action calls its real server-side authorization or validation
 * first — never a client-only guard a crafted request could skip.
 */

// ---------------------------------------------------------------------------
// Sign in / sign out
// ---------------------------------------------------------------------------

const credentialsSchema = z.object({
  email: z.string().trim().min(1).email(),
  password: z.string().min(1),
});

export type LoginErrorReason = 'validation' | 'rate_limited' | 'invalid_credentials';

export interface CustomerLoginState {
  error: LoginErrorReason | null;
  email: string | null;
}

/**
 * Mirrors admin's `loginAction` exactly, against the customer Auth.js
 * instance instead. `next` is validated by `safeAccountRedirect` before it
 * is ever used as a destination (P12 §17) — the raw form field is never
 * passed to `signIn`/`redirect` unchecked.
 */
export async function customerLoginAction(
  locale: Locale,
  next: string | null,
  _prevState: CustomerLoginState,
  formData: FormData,
): Promise<CustomerLoginState> {
  const rawEmail = formData.get('email');
  const email = typeof rawEmail === 'string' ? rawEmail : null;

  const parsed = credentialsSchema.safeParse({
    email: rawEmail,
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: 'validation', email };

  try {
    await customerSignIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: safeAccountRedirect(locale, next),
      redirect: true,
    });
  } catch (error) {
    if (error instanceof CredentialsSignin) {
      return {
        error: error.code === 'rate_limited' ? 'rate_limited' : 'invalid_credentials',
        email,
      };
    }
    if (error instanceof AuthError) {
      return { error: 'invalid_credentials', email };
    }
    throw error;
  }

  return { error: null, email: null };
}

export async function customerSignOutAction(locale: Locale): Promise<void> {
  await customerSignOut({ redirectTo: `/${locale}` });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const registerSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().min(1).email(),
    password: customerPasswordPolicySchema,
    passwordConfirmation: z.string(),
    phone: z.string().trim().max(20).optional(),
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ['passwordConfirmation'],
    message: 'passwords_do_not_match',
  });

export type RegisterErrorReason =
  'validation' | 'email_taken' | 'passwords_do_not_match' | 'generic';

export interface CustomerRegisterState {
  error: RegisterErrorReason | null;
  fieldError: string | null;
  values: { name: string; email: string; phone: string } | null;
}

/**
 * Creates the account, then signs the new customer straight in — a
 * registration that ends with "now sign in separately" is friction with no
 * security benefit, since the password was just typed and verified once
 * already. `role` never appears anywhere in this function's input: it is
 * `registerCustomer`'s own hard-coded `CUSTOMER` (P12 §3/§4), and there is
 * no form field, schema key, or parameter here that could carry one.
 */
export async function registerAction(
  locale: Locale,
  next: string | null,
  _prevState: CustomerRegisterState,
  formData: FormData,
): Promise<CustomerRegisterState> {
  const raw = {
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    passwordConfirmation: formData.get('passwordConfirmation'),
    phone: formData.get('phone') || undefined,
  };
  const values = {
    name: typeof raw.name === 'string' ? raw.name : '',
    email: typeof raw.email === 'string' ? raw.email : '',
    phone: typeof raw.phone === 'string' ? raw.phone : '',
  };

  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    const passwordMismatch = parsed.error.issues.some(
      (issue) => issue.path[0] === 'passwordConfirmation',
    );
    return {
      error: passwordMismatch ? 'passwords_do_not_match' : 'validation',
      fieldError: parsed.error.issues[0]?.message ?? null,
      values,
    };
  }

  try {
    const { user } = await registerCustomer({
      email: parsed.data.email,
      password: parsed.data.password,
      name: parsed.data.name,
      phone: parsed.data.phone ?? null,
      // Persisted so every later notification (P13's dispatcher) is sent in
      // the language the customer actually registered through, not the
      // schema's `AR` default regardless of which locale page they used.
      locale: locale === 'en' ? 'EN' : 'AR',
    });
    await recordAuditEvent({ action: 'customer.registered', userId: user.id });
    // Queued, not sent from here — P13's dispatcher mints the actual token
    // and delivers it (P12 §12).
    await queueEmailVerificationEmail(user.id);
  } catch (error) {
    if (isAppError(error) && error.code === 'CONFLICT') {
      return { error: 'email_taken', fieldError: null, values };
    }
    throw error;
  }

  try {
    await customerSignIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: safeAccountRedirect(locale, next),
      redirect: true,
    });
  } catch (error) {
    // `redirect()` throws by design on success — anything that isn't that
    // is a real sign-in failure right after a successful registration,
    // which should never happen; surfaced generically rather than left
    // unhandled, and the account still exists either way.
    if (error instanceof AuthError) {
      return { error: 'generic', fieldError: null, values: null };
    }
    throw error;
  }

  return { error: null, fieldError: null, values: null };
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

const emailSchema = z.string().trim().min(1).email();

export interface ForgotPasswordState {
  submitted: boolean;
  error: 'validation' | null;
}

/**
 * Always the same outcome shape regardless of whether the email exists
 * (P12 §13/§21) — `requestPasswordReset` itself already returns identically
 * either way; this is the form-facing mirror of that same discipline.
 *
 * Rate-limited by the target address itself (P13 §10), not by caller IP:
 * the threat this defends is one inbox getting flooded with reset emails,
 * which an attacker can mount from as many IPs as they like but only ever
 * against the one address they typed. A throttled request still returns
 * `submitted: true` — the *same* success shown to a real send — because
 * showing anything else would itself leak whether the address has an
 * account (a throttle response only for real accounts would be a new
 * enumeration channel P12 §13 already closed everywhere else).
 */
export async function forgotPasswordAction(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = emailSchema.safeParse(formData.get('email'));
  if (!parsed.success) return { submitted: false, error: 'validation' };

  const normalized = parsed.data.trim().toLowerCase();
  const rateLimit = await getPasswordResetRateLimiter().check(normalized);
  if (!rateLimit.allowed) return { submitted: true, error: null };

  await requestPasswordReset(parsed.data);
  return { submitted: true, error: null };
}

const resetPasswordSchema = z
  .object({
    password: customerPasswordPolicySchema,
    passwordConfirmation: z.string(),
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ['passwordConfirmation'],
    message: 'passwords_do_not_match',
  });

export type ResetPasswordErrorReason =
  'validation' | 'passwords_do_not_match' | 'invalid' | 'expired' | 'used';

export interface ResetPasswordState {
  done: boolean;
  error: ResetPasswordErrorReason | null;
}

export async function resetPasswordAction(
  token: string,
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get('password'),
    passwordConfirmation: formData.get('passwordConfirmation'),
  });
  if (!parsed.success) {
    const mismatch = parsed.error.issues.some((issue) => issue.path[0] === 'passwordConfirmation');
    return { done: false, error: mismatch ? 'passwords_do_not_match' : 'validation' };
  }

  const result = await resetPasswordWithToken(token, parsed.data.password);
  if (!result.ok) return { done: false, error: result.reason };

  await recordAuditEvent({ action: 'customer.password_reset_completed' });
  return { done: true, error: null };
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(20).optional(),
});

export interface UpdateProfileData {
  name: string;
  phone: string | null;
}

/**
 * `requireCustomerAccount()` first, on every call — the only identity in
 * this function is the one the session names; there is no `userId` field
 * on the form for a tampered request to substitute (P12 §7/§26).
 */
export async function updateProfileAction(
  locale: Locale,
  _prevState: ActionResult<UpdateProfileData>,
  formData: FormData,
): Promise<ActionResult<UpdateProfileData>> {
  try {
    const account = await requireCustomerAccount();
    const parsed = profileSchema.safeParse({
      name: formData.get('name'),
      phone: formData.get('phone') || undefined,
    });
    if (!parsed.success) {
      const t = getDictionary(locale).account;
      return { ok: false, error: t.profileValidationError };
    }

    const { user, customer } = await updateCustomerProfile(account.userId, {
      name: parsed.data.name,
      phone: parsed.data.phone ?? null,
    });
    await recordAuditEvent({
      action: 'customer.profile_updated',
      userId: account.userId,
      before: null,
      after: { name: user.name, phone: customer.phone },
    });

    revalidatePath(`/${locale}/account/profile`);
    revalidatePath(`/${locale}/account`);
    return { ok: true, data: { name: user.name ?? '', phone: customer.phone } };
  } catch (error) {
    const appError = toAppError(error);
    if (!isAppError(error)) console.error('updateProfileAction failed', appError.code);
    const t = getDictionary(locale).account;
    return {
      ok: false,
      error: appError.code === 'UNAUTHENTICATED' ? t.sessionExpired : t.profileError,
    };
  }
}

/** "Resend the verification email" on the account overview — queues a new
 * outbox event exactly like registration's first one. Requires a real
 * session; there is no route that hands this to an unauthenticated caller
 * or accepts a target user id. Rate-limited by the signed-in `userId` (P13
 * §10) — no enumeration concern here the way `forgotPasswordAction` has,
 * since reaching this action at all already proves the session is real, so
 * the throttled outcome is reported plainly rather than disguised as
 * success. */
export async function resendVerificationAction(): Promise<ActionResult> {
  try {
    const account = await requireCustomerAccount();

    const rateLimit = await getResendVerificationRateLimiter().check(account.userId);
    if (!rateLimit.allowed) return { ok: false, error: 'RATE_LIMITED' };

    await queueEmailVerificationEmail(account.userId);
    await recordAuditEvent({
      action: 'customer.email_verification_requested',
      userId: account.userId,
    });
    return { ok: true };
  } catch (error) {
    const appError = toAppError(error);
    if (!isAppError(error)) console.error('resendVerificationAction failed', appError.code);
    return { ok: false, error: appError.code };
  }
}
