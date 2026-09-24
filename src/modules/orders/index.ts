/**
 * `orders` — the order lifecycle, its three state machines, and its timeline.
 *
 * May depend on: core, identity, catalog, pricing, inventory, cart,
 * customers, payments, notifications
 * Must not depend on: nothing above it
 *
 * The order is the durable record of what a customer actually bought: it
 * snapshots names, SKUs and prices at the moment of purchase so a later
 * catalog change cannot rewrite history (P10 §3).
 */

export {
  placeOrder,
  cancelOrder,
  transitionOrderStatus,
  transitionFulfillmentStatus,
  transitionPaymentStatus,
  assertTransition,
  type PlaceOrderResult,
  type PlaceOrderOptions,
  type CancelOrderResult,
  type TransitionOptions,
} from './order.service';

export {
  getOrderForCustomer,
  getOrderByAccessToken,
  getOrderForAdmin,
  getOrderIdByNumber,
  listCustomerOrders,
  listOrdersForAdmin,
  type OrderView,
  type AdminOrderView,
  type OrderItemView,
  type OrderTimelineEntry,
  type CustomerOrderListItem,
  type AdminOrderListItem,
  type AdminOrderQuery,
  type AdminOrderSort,
  type Paginated,
  getOrderStatsForCustomers,
  type CustomerOrderStats,
} from './order-queries';

export {
  ORDER_STATUS_TRANSITIONS,
  PAYMENT_STATUS_TRANSITIONS,
  FULFILLMENT_STATUS_TRANSITIONS,
  CANCELLABLE_ORDER_STATUSES,
  STOCK_CONSUMED_ORDER_STATUSES,
  canTransitionOrderStatus,
  canTransitionPaymentStatus,
  canTransitionFulfillmentStatus,
  isOrderCancellable,
  hasConsumedStock,
} from './order-status';

export {
  generateOrderNumber,
  generateOrderAccessToken,
  hashOrderAccessToken,
  accessTokenHashesMatch,
  isOrderNumberShape,
} from './order-identifiers';

export {
  placeOrderInputSchema,
  shippingAddressSchema,
  checkoutContactSchema,
  normalizeSaudiPhone,
  normalizePlaceOrderInput,
  type PlaceOrderInput,
  type ShippingAddress,
} from './checkout-schemas';

// P11 — the order↔payment seam. Exported from `orders`, not `payments`,
// because the dependency only runs this way: orders may call payments, never
// the reverse.
export {
  applyVerifiedEvent,
  assessPayable,
  closeLiveAttemptForOrderWithin,
  recordRejectedDelivery,
  startPaymentForOrder,
  syncAttemptFromProvider,
} from './payment-flow.service';

export type {
  PayableCheck,
  PayableOrderFacts,
  StartPaymentInput,
  StartPaymentResult,
  WebhookApplication,
} from './payment-flow.service';
