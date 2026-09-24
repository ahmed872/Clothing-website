/**
 * A one-line pub/sub so the header's cart badge can refresh when something
 * elsewhere on the page changes the cart.
 *
 * The alternative would be to render the count in the storefront layout,
 * which would make the layout read a cookie and turn every cached category
 * and product page dynamic — trading P05's ISR for a number in the corner
 * (P09 §23). A custom event keeps the layout static and the badge live.
 */

export const CART_CHANGED_EVENT = 'luxedrive:cart-changed';

export function notifyCartChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT));
}
