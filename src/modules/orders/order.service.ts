import 'server-only';

import type {
  FulfillmentStatus,
  Order,
  OrderStatus,
  PaymentStatus,
  Prisma,
} from '@generated/prisma';

import { db, AppError, DEFAULT_CURRENCY } from '@/modules/core';
import { resolveEffectivePrice } from '@/modules/catalog';
import { getCartView, type CartOwner, type CartView } from '@/modules/cart';
import { consumeStockForOrderWithin, restoreStockForOrderWithin } from '@/modules/inventory';
import { consumeCouponUsageWithin, getCouponByCode } from '@/modules/pricing';
import { recordAuditEventWithin } from '@/modules/identity';

import {
  generateOrderAccessToken,
  generateOrderNumber,
  hashOrderAccessToken,
} from './order-identifiers';
import {
  canTransitionFulfillmentStatus,
  canTransitionOrderStatus,
  canTransitionPaymentStatus,
  hasConsumedStock,
  isOrderCancellable,
} from './order-status';
import {
  normalizePlaceOrderInput,
  placeOrderInputSchema,
  type PlaceOrderInput,
} from './checkout-schemas';
import { closeLiveAttemptForOrderWithin } from './payment-flow.service';

/**
 * Turning a cart into an order.
 *
 * The whole point of this file is that one function does the finalisation and
 * does it inside a single transaction (P10 §6). Stock, coupon, order, items,
 * events and cart clearing commit together or not at all — the alternative,
 * a sequence of independent writes, is how stores end up with stock deducted
 * for orders that were never created and coupons burned on failures.
 *
 * Nothing here trusts the caller for a number. The price comes from the
 * catalog, the discount from `PricingService` (the same one the cart page
 * uses), the totals from those two. The client supplies contact details, an
 * address, an optional note, and an idempotency key — that is the entire
 * surface (P10 §5).
 */

/** Unique-constraint violation. Two concurrent submissions of the same
 * checkout collide here, in the database, rather than racing past an
 * application-level "have we seen this key" check. */
const UNIQUE_VIOLATION = 'P2002';

type TransitionMachine = 'order' | 'payment' | 'fulfillment';

/**
 * Refuse an impossible move, loudly and with the reason attached.
 *
 * Lives here rather than beside the transition maps because it throws an
 * `AppError`, and those maps must stay importable from a client component
 * (see `order-status.ts`). Called before every status write, so a status can
 * only ever change through a transition the machine allows — there is no
 * code path that assigns one directly (P10 §10).
 */
export function assertTransition(
  machine: TransitionMachine,
  from: string,
  to: string,
  allowed: boolean,
): void {
  if (allowed) return;
  throw new AppError('INVALID_STATE_TRANSITION', {
    internalMessage: `Refused ${machine} transition ${from} → ${to}`,
    details: { machine, from, to },
  });
}

export interface PlaceOrderResult {
  order: Order;
  /** The guest's plaintext access token — returned exactly once, at creation,
   * because only its hash is stored. Null for a signed-in customer, who is
   * authorised by their session instead. */
  accessToken: string | null;
  /** True when this call recognised a repeat submission and returned the
   * order the first one created, rather than creating a second. */
  deduplicated: boolean;
}

export interface PlaceOrderOptions {
  owner: CartOwner;
  input: PlaceOrderInput;
  /** Set when a staff member places the order on a customer's behalf. */
  actorUserId?: string | null;
  now?: Date;
}

/**
 * Everything that must be true before an order may exist. Checked against the
 * recalculated cart, not against anything the client sent.
 */
function assertCartIsOrderable(cart: CartView): void {
  if (cart.lines.length === 0 || cart.itemCount === 0) {
    throw new AppError('VALIDATION_FAILED', {
      internalMessage: 'Checkout attempted with an empty cart',
      details: { reasonCode: 'cart_empty' },
    });
  }

  const blocked = cart.lines.filter((line) => line.issues.length > 0);
  if (blocked.length > 0) {
    throw new AppError('OUT_OF_STOCK', {
      internalMessage: 'Checkout attempted with unavailable lines',
      details: {
        reasonCode: 'cart_has_issues',
        skus: blocked.map((line) => line.sku),
      },
    });
  }

  if (cart.removedLines.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      internalMessage: 'Checkout attempted with lines the catalog has withdrawn',
      details: { reasonCode: 'cart_lines_removed' },
    });
  }

  // A code that is attached but no longer applies must not silently vanish
  // from the total the customer is about to be charged (P10 §20).
  if (cart.coupon && !cart.coupon.applied) {
    throw new AppError('COUPON_INVALID', {
      internalMessage: 'Checkout attempted with a coupon that no longer applies',
      details: { reasonCode: cart.coupon.rejection ?? 'coupon_invalid' },
    });
  }

  if (cart.totalMinor < 0) {
    throw new AppError('INTERNAL', {
      internalMessage: `Computed a negative total (${cart.totalMinor})`,
    });
  }
}

/** The order a signed-in customer or a guest may see. Used by the
 * idempotency fast path, which must not hand one person another's order. */
function ownsOrder(order: Order, owner: CartOwner): boolean {
  if (owner.customerId) return order.customerId === owner.customerId;
  // A guest's repeat submission is recognised by the key alone, but only
  // when the order has no customer attached — a guest key must never resolve
  // to a signed-in customer's order.
  return order.customerId === null;
}

export async function placeOrder(options: PlaceOrderOptions): Promise<PlaceOrderResult> {
  const now = options.now ?? new Date();
  const parsed = placeOrderInputSchema.parse(normalizePlaceOrderInput(options.input));

  // Fast path: a refresh or a second click that arrives after the first
  // submission committed. The slow path — two submissions in flight at once —
  // is caught by the unique constraint below.
  const existing = await db.order.findUnique({
    where: { idempotencyKey: parsed.idempotencyKey },
  });
  if (existing) {
    if (!ownsOrder(existing, options.owner)) {
      throw new AppError('FORBIDDEN', {
        internalMessage: 'Idempotency key belongs to another owner',
        details: { reasonCode: 'idempotency_key_conflict' },
      });
    }
    return { order: existing, accessToken: null, deduplicated: true };
  }

  // Authoritative recalculation, through the same path the cart page renders
  // from: current catalog prices, current promotion eligibility, current
  // stock (P10 §20). Anything the client believed is irrelevant.
  const cart = await getCartView(options.owner, { now });
  assertCartIsOrderable(cart);

  const isGuest = options.owner.customerId === null;
  const accessToken = isGuest ? generateOrderAccessToken() : null;

  // Locks are taken in a stable order so two concurrent checkouts containing
  // the same two variants cannot deadlock by locking them in opposite orders.
  const orderedLines = [...cart.lines].sort((a, b) => a.variantId.localeCompare(b.variantId));

  try {
    const order = await db.$transaction(async (tx) => {
      const created = await createOrderRow(tx, {
        cart,
        parsed,
        owner: options.owner,
        accessToken,
        now,
      });

      for (const line of orderedLines) {
        // Locks the variant row and refuses to go negative. Two checkouts
        // racing for the last unit serialise here: the second reads the
        // first's committed result and is rejected (P10 §7).
        const { variant } = await consumeStockForOrderWithin(tx, {
          variantId: line.variantId,
          quantity: line.quantity,
          orderId: created.id,
        });

        // Read the price back under the same lock. Doing it here rather than
        // before the lock closes the window in which an admin could reprice
        // between the quote and the charge — the customer is never billed an
        // amount the store no longer offers (P10 §20).
        const priceNow = resolveEffectivePrice(variant, now);
        if (priceNow.currentMinor !== line.unitPriceMinor) {
          throw new AppError('PRICE_CHANGED', {
            internalMessage: `Price moved during checkout for ${line.sku}`,
            details: {
              sku: line.sku,
              quotedMinor: line.unitPriceMinor,
              currentMinor: priceNow.currentMinor,
            },
          });
        }
      }

      await tx.orderItem.createMany({
        data: cart.lines.map((line) => ({
          orderId: created.id,
          variantId: line.variantId,
          productId: line.productId,
          productNameArSnapshot: line.productNameAr,
          productNameEnSnapshot: line.productNameEn,
          variantLabelArSnapshot: line.variantLabelAr,
          variantLabelEnSnapshot: line.variantLabelEn,
          skuSnapshot: line.sku,
          unitPriceMinor: line.unitPriceMinor,
          quantity: line.quantity,
          lineSubtotalMinor: line.lineSubtotalMinor,
          lineDiscountMinor: line.lineDiscountMinor,
          lineTotalMinor: line.lineTotalMinor,
          currency: cart.currency,
        })),
      });

      // Finalise the promotion only now, with a real order to attach it to.
      // P09 built this deliberately: eligibility is repeatable and free,
      // consumption happens once and requires an order id (P10 §8).
      if (cart.coupon?.applied) {
        const coupon = await getCouponByCode(cart.coupon.code);
        if (!coupon) {
          throw new AppError('COUPON_INVALID', {
            internalMessage: 'Coupon disappeared between evaluation and finalisation',
            details: { reasonCode: 'not_found' },
          });
        }
        await consumeCouponUsageWithin(tx, {
          couponId: coupon.id,
          customerId: options.owner.customerId,
          orderId: created.id,
        });
      }

      // The cart is consumed, not merely emptied of the things that sold:
      // everything in it became this order.
      await tx.cartItem.deleteMany({ where: { cart: cartOwnerWhere(options.owner) } });
      await tx.cart.updateMany({
        where: cartOwnerWhere(options.owner),
        data: { couponCode: null },
      });

      await tx.orderEvent.create({
        data: {
          orderId: created.id,
          type: 'CREATED',
          toValue: created.status,
          actorUserId: options.actorUserId ?? null,
        },
      });

      await recordAuditEventWithin(tx, {
        action: 'order.created',
        entityType: 'Order',
        entityId: created.id,
        userId: options.actorUserId ?? null,
        after: {
          number: created.number,
          status: created.status,
          totalMinor: created.totalMinor,
          currency: created.currency,
          itemCount: cart.itemCount,
        },
      });

      // The notification boundary (P10 §24): events are recorded for P13 to
      // deliver. Nothing is sent from here, and no provider is pretended.
      await tx.outboxEvent.createMany({
        data: [
          {
            type: 'order.created',
            payload: { orderId: created.id, number: created.number },
          },
          {
            type: 'order.payment_required',
            payload: {
              orderId: created.id,
              number: created.number,
              totalMinor: created.totalMinor,
              currency: created.currency,
            },
          },
        ],
      });

      return created;
    });

    return { order, accessToken, deduplicated: false };
  } catch (error) {
    // The concurrent case: both submissions passed the fast-path check, both
    // tried to insert, one lost the unique index. It did not create an order
    // and — because everything was one transaction — it took no stock and
    // burned no coupon. Returning the winner's order is exactly right.
    if (isUniqueViolation(error, 'idempotency_key')) {
      const winner = await db.order.findUnique({
        where: { idempotencyKey: parsed.idempotencyKey },
      });
      if (winner && ownsOrder(winner, options.owner)) {
        return { order: winner, accessToken: null, deduplicated: true };
      }
    }
    throw error;
  }
}

function cartOwnerWhere(owner: CartOwner): Prisma.CartWhereInput {
  return owner.customerId
    ? { customerId: owner.customerId }
    : { guestToken: owner.guestToken ?? '__no_such_token__' };
}

function isUniqueViolation(error: unknown, column: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== UNIQUE_VIOLATION) return false;
  const target = candidate.meta?.target;
  if (Array.isArray(target)) return target.some((entry) => String(entry).includes(column));
  return typeof target === 'string' ? target.includes(column) : true;
}

/**
 * Inserts the order row, retrying only on a number collision.
 *
 * The idempotency key's unique violation is deliberately *not* retried here —
 * it means a concurrent duplicate, which the caller handles by returning the
 * winning order.
 */
async function createOrderRow(
  tx: Prisma.TransactionClient,
  args: {
    cart: CartView;
    parsed: ReturnType<typeof placeOrderInputSchema.parse>;
    owner: CartOwner;
    accessToken: string | null;
    now: Date;
  },
): Promise<Order> {
  const { cart, parsed, owner, accessToken, now } = args;

  const data = {
    customerId: owner.customerId,
    // Every P10 order starts here: it exists, and the money does not. There
    // is no provider to move it forward, and no button that pretends
    // otherwise (P10 §11).
    status: 'PENDING_PAYMENT' as OrderStatus,
    paymentStatus: 'UNPAID' as PaymentStatus,
    fulfillmentStatus: 'UNFULFILLED' as FulfillmentStatus,
    source: 'ONLINE' as const,
    subtotalMinor: cart.subtotalMinor,
    discountMinor: cart.discountMinor,
    // Not calculated, not faked: no shipping or tax engine exists yet, so
    // both are zero and the grand total is subtotal minus discount (P10 §21).
    shippingMinor: 0,
    taxMinor: 0,
    totalMinor: cart.totalMinor,
    currency: cart.currency || DEFAULT_CURRENCY,
    couponCode: cart.coupon?.applied ? cart.coupon.code : null,
    shippingAddress: parsed.shippingAddress as unknown as Prisma.InputJsonValue,
    contactName: parsed.shippingAddress.fullName,
    customerEmail: parsed.contact.email,
    customerPhone: parsed.contact.phone,
    note: parsed.note ?? null,
    accessTokenHash: accessToken ? hashOrderAccessToken(accessToken) : null,
    idempotencyKey: parsed.idempotencyKey,
    placedAt: now,
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await tx.order.create({ data: { ...data, number: generateOrderNumber(now) } });
    } catch (error) {
      if (isUniqueViolation(error, 'number') && !isUniqueViolation(error, 'idempotency_key')) {
        continue;
      }
      throw error;
    }
  }

  throw new AppError('INTERNAL', {
    internalMessage: 'Could not allocate a unique order number after 5 attempts',
  });
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface TransitionOptions {
  actorUserId?: string | null;
  note?: string | null;
}

/**
 * The only way an order's status changes.
 *
 * No route, action or component assigns a status directly; they all come
 * through here, so an impossible move is refused in one place rather than
 * defended in several (P10 §10). Every accepted move writes a timeline entry
 * naming who made it and when.
 */
export async function transitionOrderStatus(
  orderId: string,
  to: OrderStatus,
  options: TransitionOptions = {},
): Promise<Order> {
  return db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError('NOT_FOUND', { details: { entity: 'Order', id: orderId } });

    assertTransition('order', order.status, to, canTransitionOrderStatus(order.status, to));

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        status: to,
        ...(to === 'CONFIRMED' ? { confirmedAt: new Date() } : {}),
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId,
        type: 'ORDER_STATUS',
        fromValue: order.status,
        toValue: to,
        actorUserId: options.actorUserId ?? null,
        note: options.note ?? null,
      },
    });

    await recordAuditEventWithin(tx, {
      action: 'order.status_changed',
      entityType: 'Order',
      entityId: orderId,
      userId: options.actorUserId ?? null,
      before: { status: order.status },
      after: { status: to },
    });

    if (to === 'CONFIRMED') {
      await tx.outboxEvent.create({
        data: { type: 'order.confirmed', payload: { orderId, number: order.number } },
      });
    }

    return updated;
  });
}

/** Same rules, for the shipment. Kept separate because a shipment moving does
 * not imply the money moved, and conflating them is what the three-machine
 * split exists to prevent. */
export async function transitionFulfillmentStatus(
  orderId: string,
  to: FulfillmentStatus,
  options: TransitionOptions = {},
): Promise<Order> {
  return db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError('NOT_FOUND', { details: { entity: 'Order', id: orderId } });

    assertTransition(
      'fulfillment',
      order.fulfillmentStatus,
      to,
      canTransitionFulfillmentStatus(order.fulfillmentStatus, to),
    );

    const updated = await tx.order.update({
      where: { id: orderId },
      data: { fulfillmentStatus: to },
    });

    await tx.orderEvent.create({
      data: {
        orderId,
        type: 'FULFILLMENT_STATUS',
        fromValue: order.fulfillmentStatus,
        toValue: to,
        actorUserId: options.actorUserId ?? null,
        note: options.note ?? null,
      },
    });

    await recordAuditEventWithin(tx, {
      action: 'order.fulfillment_changed',
      entityType: 'Order',
      entityId: orderId,
      userId: options.actorUserId ?? null,
      before: { fulfillmentStatus: order.fulfillmentStatus },
      after: { fulfillmentStatus: to },
    });

    return updated;
  });
}

/**
 * The payment machine, exposed but unused by P10.
 *
 * P10 writes UNPAID and stops. This function exists so P11's webhook handler
 * has a domain entry point to call instead of updating the column itself —
 * the transition rules and the timeline entry are already here, waiting.
 */
export async function transitionPaymentStatus(
  orderId: string,
  to: PaymentStatus,
  options: TransitionOptions = {},
): Promise<Order> {
  return db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError('NOT_FOUND', { details: { entity: 'Order', id: orderId } });

    assertTransition(
      'payment',
      order.paymentStatus,
      to,
      canTransitionPaymentStatus(order.paymentStatus, to),
    );

    const updated = await tx.order.update({ where: { id: orderId }, data: { paymentStatus: to } });

    await tx.orderEvent.create({
      data: {
        orderId,
        type: 'PAYMENT_STATUS',
        fromValue: order.paymentStatus,
        toValue: to,
        actorUserId: options.actorUserId ?? null,
        note: options.note ?? null,
      },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export interface CancelOrderResult {
  order: Order;
  /** False when the order was already cancelled — the call succeeded and
   * changed nothing, which is what makes a retry safe. */
  cancelled: boolean;
  restoredQuantity: number;
}

/**
 * Cancels an order and gives its stock back, exactly once.
 *
 * Idempotency is structural rather than hopeful: `inventoryRestoredAt` is
 * stamped in the same transaction as the restoration, and its presence is
 * what a repeat call sees. Two cancellations racing serialise on the order
 * row lock, and the second finds the stamp and restores nothing (P10 §18).
 *
 * Cancelling is not refunding. P10 has no payment provider, so an order here
 * is by definition UNPAID and there is nothing to return; the payment status
 * is deliberately left alone for P11 to own (P10 §17).
 */
export async function cancelOrder(
  orderId: string,
  options: TransitionOptions & { reason?: string | null } = {},
): Promise<CancelOrderResult> {
  return db.$transaction(async (tx) => {
    // Lock the order first: this is what makes two concurrent cancellations
    // safe, and it must be taken before anything is read or decided.
    const locked = await tx.$queryRaw<
      { status: OrderStatus; inventory_restored_at: Date | null }[]
    >`SELECT status, inventory_restored_at FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;

    const current = locked[0];
    if (!current) throw new AppError('NOT_FOUND', { details: { entity: 'Order', id: orderId } });

    if (current.status === 'CANCELLED') {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      return { order, cancelled: false, restoredQuantity: 0 };
    }

    if (!isOrderCancellable(current.status)) {
      throw new AppError('INVALID_STATE_TRANSITION', {
        internalMessage: `Order in ${current.status} cannot be cancelled`,
        details: { machine: 'order', from: current.status, to: 'CANCELLED' },
      });
    }

    assertTransition(
      'order',
      current.status,
      'CANCELLED',
      canTransitionOrderStatus(current.status, 'CANCELLED'),
    );

    let restoredQuantity = 0;
    const shouldRestore =
      current.inventory_restored_at === null && hasConsumedStock(current.status);

    if (shouldRestore) {
      const items = await tx.orderItem.findMany({
        where: { orderId },
        orderBy: { variantId: 'asc' },
      });

      for (const item of items) {
        if (!item.variantId) continue; // variant deleted; nothing to restore to
        await restoreStockForOrderWithin(tx, {
          variantId: item.variantId,
          quantity: item.quantity,
          orderId,
          actorUserId: options.actorUserId ?? null,
        });
        restoredQuantity += item.quantity;
      }
    }

    // P11: a provider session must not outlive the order it was paying for.
    // Idempotent and quiet — an attempt that already settled is left alone,
    // because cancelling an order cannot un-take money that arrived.
    await closeLiveAttemptForOrderWithin(tx, orderId);

    const order = await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        fulfillmentStatus: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: options.reason ?? null,
        ...(shouldRestore ? { inventoryRestoredAt: new Date() } : {}),
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId,
        type: 'ORDER_STATUS',
        fromValue: current.status,
        toValue: 'CANCELLED',
        actorUserId: options.actorUserId ?? null,
        note: options.reason ?? options.note ?? null,
      },
    });

    await recordAuditEventWithin(tx, {
      action: 'order.cancelled',
      entityType: 'Order',
      entityId: orderId,
      userId: options.actorUserId ?? null,
      before: { status: current.status },
      after: { status: 'CANCELLED', restoredQuantity },
    });

    await tx.outboxEvent.create({
      data: {
        type: 'order.cancelled',
        payload: { orderId, number: order.number, restoredQuantity },
      },
    });

    return { order, cancelled: true, restoredQuantity };
  });
}
