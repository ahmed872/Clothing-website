'use server';

import { revalidatePath } from 'next/cache';

import { isAppError, toAppError } from '@/modules/core';
import { recordAuditEvent } from '@/modules/identity';
import {
  MEASUREMENT_KEYS,
  bodyProfileInputSchema,
  deleteBodyProfile,
  fieldErrorsFromIssues,
  saveBodyProfile,
  serializeBodyProfile,
  type BodyProfileErrorCode,
  type BodyProfileField,
  type BodyProfileInput,
  type BodyProfileSnapshot,
} from '@/modules/body-profile';
import { isLocale, type Locale } from '@/lib/i18n/locales';

import { requireCustomerAccount } from './customer-identity';

/**
 * The customer's own body profile — save and delete (clothing P01).
 *
 * Ownership, the way every account action here does it: the first call is
 * always `requireCustomerAccount()`, and the customer id handed to the
 * service is the one that session names. Neither action has a parameter, a
 * bound argument or a form field that could carry a customer, profile or
 * avatar id; the form is read field by field (`inputFromForm`), so an extra
 * `customerId=…` in a crafted request is never even looked at, and the
 * service's strict schema would refuse it if it were.
 *
 * CSRF: these are Server Actions — POST-only, and Next.js aborts any whose
 * `Origin` does not match the host serving the page (see
 * `e2e/body-profile.spec.ts`, which replays one from a foreign origin), on
 * top of the session cookie's own `SameSite=Lax`.
 *
 * Privacy: the audit trail records *that* a profile was saved or deleted,
 * never the measurements or appearance; errors are logged by code only.
 */

export type BodyProfileFormError = 'invalid' | 'stale' | 'session_expired' | 'generic';

export interface BodyProfileFormState {
  status: 'idle' | 'saved' | 'error';
  profile?: BodyProfileSnapshot;
  formError?: BodyProfileFormError;
  fieldErrors?: Partial<Record<BodyProfileField, BodyProfileErrorCode>>;
}

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === 'string' ? value : undefined;
}

/** Only the fields a body profile has — by name, nothing else. */
function inputFromForm(formData: FormData): BodyProfileInput {
  const measurements = Object.fromEntries(
    MEASUREMENT_KEYS.map((key) => [key, text(formData, key)]),
  );
  const wearsGlasses = text(formData, 'wearsGlasses');
  return {
    gender: text(formData, 'gender'),
    fitPreference: text(formData, 'fitPreference'),
    ...measurements,
    avatar: {
      skinTone: text(formData, 'skinTone'),
      hairStyle: text(formData, 'hairStyle'),
      hairColor: text(formData, 'hairColor'),
      facialHair: text(formData, 'facialHair'),
      wearsGlasses: wearsGlasses === 'true' || wearsGlasses === 'on',
      glassesStyle: text(formData, 'glassesStyle'),
      glassesFrameColor: text(formData, 'glassesFrameColor'),
    },
  } as BodyProfileInput;
}

/** The version the form was showing: absent → no check, `''` → "there was
 * no profile yet", an ISO timestamp → that version. */
function expectedVersionFromForm(formData: FormData): Date | null | undefined | 'invalid' {
  const raw = text(formData, 'expectedUpdatedAt');
  if (raw === undefined) return undefined;
  if (raw === '') return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? 'invalid' : date;
}

function revalidateBodyProfile(locale: Locale): void {
  // A bound argument is still client input: only a real locale names a path.
  if (!isLocale(locale)) return;
  revalidatePath(`/${locale}/account/body-profile`);
}

function failure(error: unknown, action: string): BodyProfileFormState {
  const appError = toAppError(error);
  // The code only — never the submitted values.
  if (!isAppError(error)) console.error(`${action} failed`, appError.code);
  if (appError.code === 'UNAUTHENTICATED') return { status: 'error', formError: 'session_expired' };
  if (appError.code === 'CONFLICT') return { status: 'error', formError: 'stale' };
  return { status: 'error', formError: 'generic' };
}

export async function saveBodyProfileAction(
  locale: Locale,
  _prevState: BodyProfileFormState,
  formData: FormData,
): Promise<BodyProfileFormState> {
  try {
    const account = await requireCustomerAccount();

    const input = inputFromForm(formData);
    const parsed = bodyProfileInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        status: 'error',
        formError: 'invalid',
        fieldErrors: fieldErrorsFromIssues(parsed.error.issues),
      };
    }
    const expectedUpdatedAt = expectedVersionFromForm(formData);
    if (expectedUpdatedAt === 'invalid') return { status: 'error', formError: 'stale' };

    const saved = await saveBodyProfile(account.customerId, parsed.data, { expectedUpdatedAt });
    await recordAuditEvent({ action: 'customer.body_profile_saved', userId: account.userId });

    revalidateBodyProfile(locale);
    return { status: 'saved', profile: serializeBodyProfile(saved) };
  } catch (error) {
    return failure(error, 'saveBodyProfileAction');
  }
}

export type DeleteBodyProfileResult =
  { ok: true } | { ok: false; error: Exclude<BodyProfileFormError, 'invalid'> };

export async function deleteBodyProfileAction(locale: Locale): Promise<DeleteBodyProfileResult> {
  try {
    const account = await requireCustomerAccount();
    const deleted = await deleteBodyProfile(account.customerId);
    if (deleted) {
      await recordAuditEvent({ action: 'customer.body_profile_deleted', userId: account.userId });
    }
    revalidateBodyProfile(locale);
    return { ok: true };
  } catch (error) {
    const state = failure(error, 'deleteBodyProfileAction');
    return {
      ok: false,
      error: state.formError === 'invalid' || !state.formError ? 'generic' : state.formError,
    };
  }
}
