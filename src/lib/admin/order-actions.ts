'use server';

import { revalidatePath } from 'next/cache';
import type { FulfillmentStatus, OrderStatus } from '@generated/prisma';

import { isAppError, toAppError } from '@/modules/core';
import {
  cancelOrder,
  getOrderIdByNumber,
  transitionFulfillmentStatus,
  transitionOrderStatus,
} from '@/modules/orders';
import { requirePermission } from '@/modules/identity';
import type { ActionResult } from '@/lib/admin/action-result';

/**
 * Admin order mutations.
 *
 * Three things are true of every action here, and they are what make the
 * admin surface safe rather than merely convenient:
 *
 *  1. `requirePermission` runs on the server before anything else. Hiding a
 *     button is a courtesy; this is the control (P10 §31).
 *  2. The client names an order by its *number* and an intent by a fixed
 *     union — never a raw status string, and never an internal id. There is
 *     no payload that can set an arbitrary status.
 *  3. The domain refuses impossible moves. These actions do not re-implement
 *     the state machine; they call it and translate its failure.
 *
 * There is deliberately no action that marks an order paid. P10 has no
 * payment provider, and a button that flips `paymentStatus` to PAID would be
 * exactly the fake success P11 is supposed to make real (P10 §11).
 */

/** The moves an admin may make, named as intents rather than target states
 * so the set is closed and reviewable in one glance. */
export type OrderAdminIntent = 'confirm' | 'process' | 'complete';
export type FulfillmentIntent = 'prepare' | 'ship' | 'deliver';

const ORDER_INTENTS: Record<OrderAdminIntent, OrderStatus> = {
  confirm: 'CONFIRMED',
  process: 'PROCESSING',
  complete: 'COMPLETED',
};

const FULFILLMENT_INTENTS: Record<FulfillmentIntent, FulfillmentStatus> = {
  prepare: 'PROCESSING',
  ship: 'SHIPPED',
  deliver: 'DELIVERED',
};

async function resolve(number: string): Promise<string | null> {
  return getOrderIdByNumber(number);
}

function failure(error: unknown): ActionResult<never> {
  const appError = toAppError(error);
  if (!isAppError(error)) {
    console.error('admin order action failed', appError.cause ?? appError);
  }
  // The admin reads English or Arabic depending on their own preference, and
  // `AppError` carries both — the caller picks.
  return { ok: false, error: appError.code };
}

function revalidateOrder(number: string): void {
  revalidatePath('/admin/orders');
  revalidatePath(`/admin/orders/${number}`);
}

export async function advanceOrderAction(
  number: string,
  intent: OrderAdminIntent,
): Promise<ActionResult> {
  try {
    const actor = await requirePermission('orders.update');
    const id = await resolve(number);
    if (!id) return { ok: false, error: 'NOT_FOUND' };

    await transitionOrderStatus(id, ORDER_INTENTS[intent], { actorUserId: actor.id });
    revalidateOrder(number);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function advanceFulfillmentAction(
  number: string,
  intent: FulfillmentIntent,
): Promise<ActionResult> {
  try {
    const actor = await requirePermission('orders.update');
    const id = await resolve(number);
    if (!id) return { ok: false, error: 'NOT_FOUND' };

    await transitionFulfillmentStatus(id, FULFILLMENT_INTENTS[intent], { actorUserId: actor.id });
    revalidateOrder(number);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelOrderAction(
  number: string,
  reason?: string,
): Promise<ActionResult<{ restoredQuantity: number; alreadyCancelled: boolean }>> {
  try {
    const actor = await requirePermission('orders.update');
    const id = await resolve(number);
    if (!id) return { ok: false, error: 'NOT_FOUND' };

    const result = await cancelOrder(id, {
      actorUserId: actor.id,
      reason: reason?.trim() || null,
    });

    revalidateOrder(number);
    return {
      ok: true,
      data: {
        restoredQuantity: result.restoredQuantity,
        alreadyCancelled: !result.cancelled,
      },
    };
  } catch (error) {
    return failure(error);
  }
}
