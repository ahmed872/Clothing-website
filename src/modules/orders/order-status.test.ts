import { describe, expect, it } from 'vitest';

import { AppError } from '@/modules/core';

import { assertTransition } from './order.service';
import {
  CANCELLABLE_ORDER_STATUSES,
  FULFILLMENT_STATUS_TRANSITIONS,
  ORDER_STATUS_TRANSITIONS,
  PAYMENT_STATUS_TRANSITIONS,
  canTransitionFulfillmentStatus,
  canTransitionOrderStatus,
  canTransitionPaymentStatus,
  hasConsumedStock,
  isOrderCancellable,
} from './order-status';

/**
 * The state machines, with no database in sight. Every edge is asserted both
 * ways round: allowing a move nobody should make is the same class of bug as
 * refusing one everybody needs.
 */

describe('order status machine', () => {
  it('lets an unpaid order be confirmed or cancelled, and nothing else', () => {
    expect(canTransitionOrderStatus('PENDING_PAYMENT', 'CONFIRMED')).toBe(true);
    expect(canTransitionOrderStatus('PENDING_PAYMENT', 'CANCELLED')).toBe(true);
    expect(canTransitionOrderStatus('PENDING_PAYMENT', 'PROCESSING')).toBe(false);
    expect(canTransitionOrderStatus('PENDING_PAYMENT', 'COMPLETED')).toBe(false);
  });

  it('walks the fulfilment path forward one step at a time', () => {
    expect(canTransitionOrderStatus('CONFIRMED', 'PROCESSING')).toBe(true);
    expect(canTransitionOrderStatus('PROCESSING', 'COMPLETED')).toBe(true);
    // No skipping: a confirmed order cannot jump straight to completed.
    expect(canTransitionOrderStatus('CONFIRMED', 'COMPLETED')).toBe(false);
  });

  it('never moves backwards', () => {
    expect(canTransitionOrderStatus('CONFIRMED', 'PENDING_PAYMENT')).toBe(false);
    expect(canTransitionOrderStatus('PROCESSING', 'CONFIRMED')).toBe(false);
    expect(canTransitionOrderStatus('COMPLETED', 'PROCESSING')).toBe(false);
  });

  it('treats COMPLETED and CANCELLED as terminal', () => {
    expect(ORDER_STATUS_TRANSITIONS.COMPLETED).toHaveLength(0);
    expect(ORDER_STATUS_TRANSITIONS.CANCELLED).toHaveLength(0);
    expect(canTransitionOrderStatus('CANCELLED', 'CONFIRMED')).toBe(false);
    // Re-cancelling is not a transition — `cancelOrder` treats it as a no-op.
    expect(canTransitionOrderStatus('CANCELLED', 'CANCELLED')).toBe(false);
  });

  it('never lets a status transition to itself', () => {
    for (const [from, targets] of Object.entries(ORDER_STATUS_TRANSITIONS)) {
      expect(targets).not.toContain(from);
    }
  });

  it('agrees with the cancellable list', () => {
    for (const status of CANCELLABLE_ORDER_STATUSES) {
      expect(isOrderCancellable(status)).toBe(true);
      expect(canTransitionOrderStatus(status, 'CANCELLED')).toBe(true);
    }
    expect(isOrderCancellable('COMPLETED')).toBe(false);
    expect(isOrderCancellable('CANCELLED')).toBe(false);
  });

  it('knows which statuses have taken stock out of the warehouse', () => {
    expect(hasConsumedStock('PENDING_PAYMENT')).toBe(true);
    expect(hasConsumedStock('COMPLETED')).toBe(true);
    // Already given back — restoring again is what §18 forbids.
    expect(hasConsumedStock('CANCELLED')).toBe(false);
  });
});

describe('payment status machine', () => {
  it('starts unpaid and can only move where a provider would take it', () => {
    expect(canTransitionPaymentStatus('UNPAID', 'PAID')).toBe(true);
    expect(canTransitionPaymentStatus('UNPAID', 'PENDING')).toBe(true);
    expect(canTransitionPaymentStatus('UNPAID', 'REFUNDED')).toBe(false);
  });

  it('will not refund money that never arrived', () => {
    expect(canTransitionPaymentStatus('UNPAID', 'REFUNDED')).toBe(false);
    expect(canTransitionPaymentStatus('FAILED', 'REFUNDED')).toBe(false);
    expect(canTransitionPaymentStatus('PAID', 'REFUNDED')).toBe(true);
  });

  it('treats a full refund as terminal', () => {
    expect(PAYMENT_STATUS_TRANSITIONS.REFUNDED).toHaveLength(0);
    expect(canTransitionPaymentStatus('REFUNDED', 'PAID')).toBe(false);
  });
});

describe('fulfillment status machine', () => {
  it('ships before it delivers', () => {
    expect(canTransitionFulfillmentStatus('UNFULFILLED', 'PROCESSING')).toBe(true);
    expect(canTransitionFulfillmentStatus('PROCESSING', 'SHIPPED')).toBe(true);
    expect(canTransitionFulfillmentStatus('SHIPPED', 'DELIVERED')).toBe(true);
    expect(canTransitionFulfillmentStatus('UNFULFILLED', 'SHIPPED')).toBe(false);
    expect(canTransitionFulfillmentStatus('UNFULFILLED', 'DELIVERED')).toBe(false);
  });

  it('cannot cancel a shipment that already arrived', () => {
    expect(canTransitionFulfillmentStatus('SHIPPED', 'CANCELLED')).toBe(false);
    expect(canTransitionFulfillmentStatus('DELIVERED', 'CANCELLED')).toBe(false);
    expect(FULFILLMENT_STATUS_TRANSITIONS.DELIVERED).toHaveLength(0);
  });
});

describe('assertTransition', () => {
  it('says nothing when the move is allowed', () => {
    expect(() => assertTransition('order', 'CONFIRMED', 'PROCESSING', true)).not.toThrow();
  });

  it('refuses with a typed error naming both ends', () => {
    try {
      assertTransition('order', 'COMPLETED', 'PENDING_PAYMENT', false);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe('INVALID_STATE_TRANSITION');
      expect(appError.httpStatus).toBe(409);
      expect(appError.details).toMatchObject({
        machine: 'order',
        from: 'COMPLETED',
        to: 'PENDING_PAYMENT',
      });
      // The customer-facing message must not leak enum names.
      expect(appError.messageFor('en')).not.toContain('PENDING_PAYMENT');
    }
  });
});
