/**
 * `cart` — cart lifecycle for guests and signed-in customers.
 *
 * May depend on: core, catalog, pricing, inventory
 * Must not depend on: orders, payments
 *
 * P09 implementation. Two rules shape everything here:
 *
 * 1. The client says *which variant* and *how many*. Nothing else. Price,
 *    availability, product state and totals are resolved on the server on
 *    every read, so a stale tab or a crafted payload can ask for an old
 *    price and simply not get it.
 *
 * 2. A cart is not a reservation. Having something in a basket holds no
 *    stock and consumes no promotion usage — those are three different
 *    things and P09 only does the first:
 *
 *      cart availability  — "you could buy this right now" (recomputed)
 *      inventory reservation — not implemented, deliberately
 *      order confirmation — P10
 *
 * Cart identity never travels in a request body: a guest is identified by an
 * httpOnly cookie token and a customer by their session, so there is no cart
 * id for anyone to substitute.
 *
 * Other modules import `@/modules/cart`, never a file inside it.
 */

export {
  findCart,
  getOrCreateCart,
  addItem,
  updateItemQuantity,
  removeItem,
  clearCart,
  setCartCoupon,
  mergeGuestCartIntoCustomer,
  newGuestToken,
  purchasableQuantity,
  MAX_LINE_QUANTITY,
  type CartOwner,
} from './cart.service';

export {
  getCartView,
  getCartItemCount,
  EMPTY_CART,
  type CartView,
  type CartLineView,
  type CartLineIssue,
  type CartCouponView,
} from './cart-view.service';
