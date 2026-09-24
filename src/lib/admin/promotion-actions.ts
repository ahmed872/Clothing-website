'use server';

import { revalidatePath } from 'next/cache';

import { adminErrorMessage } from '@/lib/admin/admin-error-message';
import { requirePermission, recordAuditEvent } from '@/modules/identity';
import {
  createCoupon,
  deleteCoupon,
  setCouponActive,
  updateCoupon,
  type CouponInput,
} from '@/modules/pricing';
import type { Locale } from '@/lib/i18n/locales';
import type { ActionResult } from '@/lib/admin/action-result';

/**
 * Promotion management.
 *
 * `discounts.manage` — the permission P06 already defines for exactly this,
 * held by MANAGER and OWNER. STAFF can read the catalog and count stock but
 * cannot create money-off rules, which is the intended split.
 *
 * Every mutation is audited: a discount rule is a commercial commitment, and
 * "who made this 50% off, and when" has to be answerable afterwards.
 *
 * Nothing here revalidates a storefront path. A promotion is only ever
 * applied while pricing a cart, and the cart is recalculated on every read
 * from live coupon rows — so a promotion switched off in the admin stops
 * discounting on the customer's very next cart view, with no cache to
 * invalidate (P09 §23). The admin's own list is revalidated so the editor
 * sees their change immediately.
 */

/** Dates arrive from a form as strings; an unparseable one is a validation
 * failure rather than an `Invalid Date` smuggled into the domain. */
function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface PromotionFormInput {
  code: string;
  type: 'PERCENTAGE' | 'FIXED';
  value: number;
  descriptionAr: string | null;
  descriptionEn: string | null;
  minOrderMinor: number | null;
  maxDiscountMinor: number | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  scopes: { scopeType: 'PRODUCT' | 'CATEGORY' | 'BRAND'; targetId: string }[];
}

function toDomainInput(input: PromotionFormInput): CouponInput {
  return {
    code: input.code,
    type: input.type,
    value: input.value,
    descriptionAr: input.descriptionAr,
    descriptionEn: input.descriptionEn,
    minOrderMinor: input.minOrderMinor,
    maxDiscountMinor: input.maxDiscountMinor,
    usageLimit: input.usageLimit,
    perCustomerLimit: input.perCustomerLimit,
    startsAt: parseDate(input.startsAt),
    endsAt: parseDate(input.endsAt),
    active: input.active,
    scopes: input.scopes,
  } as CouponInput;
}

/** What an audit snapshot records: the rule, never a secret. */
function auditSnapshot(input: PromotionFormInput) {
  return {
    code: input.code,
    type: input.type,
    value: input.value,
    minOrderMinor: input.minOrderMinor,
    maxDiscountMinor: input.maxDiscountMinor,
    usageLimit: input.usageLimit,
    perCustomerLimit: input.perCustomerLimit,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    active: input.active,
    scopeCount: input.scopes.length,
  };
}

export async function createPromotionAction(
  input: PromotionFormInput,
  locale: Locale,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('discounts.manage');
    const coupon = await createCoupon(toDomainInput(input));

    await recordAuditEvent({
      action: 'promotion.created',
      entityType: 'Coupon',
      userId: user.id,
      entityId: coupon.id,
      after: auditSnapshot(input),
    });

    revalidatePath('/admin/promotions');
    return { ok: true, data: { id: coupon.id } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function updatePromotionAction(
  id: string,
  input: PromotionFormInput,
  expectedUpdatedAt: string | null,
  locale: Locale,
): Promise<ActionResult<{ updatedAt: string }>> {
  try {
    const user = await requirePermission('discounts.manage');
    const coupon = await updateCoupon(
      id,
      toDomainInput(input),
      expectedUpdatedAt ? new Date(expectedUpdatedAt) : undefined,
    );

    await recordAuditEvent({
      action: 'promotion.updated',
      entityType: 'Coupon',
      userId: user.id,
      entityId: id,
      after: auditSnapshot(input),
    });

    revalidatePath('/admin/promotions');
    revalidatePath(`/admin/promotions/${id}`);
    return { ok: true, data: { updatedAt: coupon.updatedAt.toISOString() } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function setPromotionActiveAction(
  id: string,
  active: boolean,
  locale: Locale,
): Promise<ActionResult> {
  try {
    const user = await requirePermission('discounts.manage');
    await setCouponActive(id, active);

    await recordAuditEvent({
      action: active ? 'promotion.activated' : 'promotion.deactivated',
      entityType: 'Coupon',
      userId: user.id,
      entityId: id,
      after: { active },
    });

    revalidatePath('/admin/promotions');
    revalidatePath(`/admin/promotions/${id}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function deletePromotionAction(id: string, locale: Locale): Promise<ActionResult> {
  try {
    const user = await requirePermission('discounts.manage');
    await deleteCoupon(id);

    await recordAuditEvent({
      action: 'promotion.deleted',
      entityType: 'Coupon',
      userId: user.id,
      entityId: id,
    });

    revalidatePath('/admin/promotions');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}
