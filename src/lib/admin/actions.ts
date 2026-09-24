'use server';

import { AuthError, CredentialsSignin } from 'next-auth';
import { z } from 'zod';

import { signIn, signOut } from '@/modules/identity';

/**
 * `signOut` (Auth.js) both clears the session cookie and fires the
 * `events.signOut` callback in `auth.ts`, which is what actually deletes
 * the matching `Session` DB row and writes the `auth.logout` audit event —
 * so calling this one function is a real, server-verified logout, not just
 * a client-side "forget the token."
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/admin/login' });
}

const credentialsSchema = z.object({
  email: z.string().trim().min(1).email(),
  password: z.string().min(1),
});

/**
 * Every reason this can fail collapses to one of three UI-facing buckets —
 * never "no such email" or "account disabled" (P06 §11's login-error
 * mandate). `rate_limited` is the one deliberate exception: it doesn't
 * correlate with whether an account exists (it fires identically for any
 * (ip, email) pair that's made too many attempts), so telling the caller
 * "wait a moment" leaks nothing an attacker couldn't already tell from the
 * response timing.
 */
export type LoginErrorReason = 'validation' | 'rate_limited' | 'invalid_credentials';

export interface LoginActionState {
  error: LoginErrorReason | null;
  /** Echoed back so a failed attempt doesn't force retyping the email —
   * `loginAction` never echoes the password back, on any path. */
  email: string | null;
}

/**
 * The login form's action. `authorize()` in `auth.ts` is the real
 * authority — this only translates whatever it decides into one of the
 * three generic reasons above, following the same try/catch-`AuthError`
 * shape Auth.js's own docs use for a credentials Server Action: `signIn`
 * throws on failure and calls Next's `redirect()` (which itself throws, by
 * design) on success, so anything that isn't a recognized auth failure is
 * rethrown rather than swallowed — swallowing it here would break the
 * post-login redirect.
 */
export async function loginAction(
  _prevState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const rawEmail = formData.get('email');
  const email = typeof rawEmail === 'string' ? rawEmail : null;

  const parsed = credentialsSchema.safeParse({
    email: rawEmail,
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: 'validation', email };

  try {
    await signIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: '/admin',
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
