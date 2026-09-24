import { randomBytes } from 'node:crypto';

import { db, AppError } from '@/modules/core';

/**
 * The cart, owned by the server.
 *
 * The client may say which variant and how many. Everything else — the
 * product, the price, whether it is buyable, the totals — is resolved here
 * from the catalog on every read (P09 §4). Nothing about a price or an
 * availability is remembered between requests, which is what makes a stale
 * tab harmless: it can ask for an old price, and simply not get it.
 */

/** 32 bytes of randomness, base64url. This token *is* the guest's
 * credential: it lives in an httpOnly cookie, is never rendered into a page,
 * and is the only way to reach a guest cart. Cart ids are never accepted
 * from a client, so there is no identifier to tamper with (P09 §19). */
export function newGuestToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface CartOwner {
  customerId: string | null;
  guestToken: string | null;
}

function ownerWhere(owner: CartOwner) {
  if (owner.customerId) return { customerId: owner.customerId };
  if (owner.guestToken) return { guestToken: owner.guestToken };
  throw new AppError('VALIDATION_FAILED', {
    internalMessage: 'A cart needs either a customerId or a guestToken',
  });
}

/** Finds the caller's cart without creating one — for reads, where an
 * absent cart is simply an empty cart rather than a row worth writing. */
export async function findCart(owner: CartOwner) {
  if (!owner.customerId && !owner.guestToken) return null;
  return db.cart.findFirst({ where: ownerWhere(owner), orderBy: { createdAt: 'desc' } });
}

export async function getOrCreateCart(owner: CartOwner) {
  const existing = await findCart(owner);
  if (existing) return existing;

  return db.cart.create({
    data: {
      customerId: owner.customerId,
      guestToken: owner.customerId ? null : owner.guestToken,
    },
  });
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export type LineIssue = 'unavailable' | 'out_of_stock' | 'quantity_reduced' | 'price_changed';

const MAX_LINE_QUANTITY = 99;

/**
 * How many of this variant a customer may actually have.
 *
 * `trackInventory: false` means the store does not count this variant, so it
 * is always buyable — the same rule the storefront badge and the admin
 * screen already apply (P08). Treating an untracked variant as out of stock
 * because its counter happens to read zero would be wrong in exactly the
 * case the flag exists for.
 */
export function purchasableQuantity(variant: {
  trackInventory: boolean;
  stockQuantity: number;
}): number {
  if (!variant.trackInventory) return MAX_LINE_QUANTITY;
  return Math.max(0, Math.min(MAX_LINE_QUANTITY, variant.stockQuantity));
}

const variantInclude = {
  product: {
    select: {
      id: true,
      slug: true,
      status: true,
      deletedAt: true,
      nameAr: true,
      nameEn: true,
      categoryId: true,
      brandId: true,
      images: {
        orderBy: { position: 'asc' },
        take: 1,
        select: { asset: { select: { url: true } }, altAr: true, altEn: true },
      },
    },
  },
  optionValues: { include: { optionValue: { include: { option: true } } } },
} as const;

/** A variant is only addable if its product is actually on sale in the
 * store: a draft, an archived product or a soft-deleted one is not
 * something a customer can put in a basket, whatever id they send. */
function isPurchasable(product: { status: string; deletedAt: Date | null }): boolean {
  return product.status === 'PUBLISHED' && product.deletedAt === null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function addItem(
  owner: CartOwner,
  input: { variantId: string; quantity: number },
): Promise<void> {
  const quantity = assertQuantity(input.quantity, { allowZero: false });

  const variant = await db.variant.findUnique({
    where: { id: input.variantId },
    include: { product: { select: { status: true, deletedAt: true } } },
  });
  if (!variant || !isPurchasable(variant.product)) {
    throw new AppError('NOT_FOUND', { details: { entity: 'Variant', id: input.variantId } });
  }

  const cart = await getOrCreateCart(owner);
  const existing = await db.cartItem.findUnique({
    where: { cartId_variantId: { cartId: cart.id, variantId: input.variantId } },
  });

  const requested = (existing?.quantity ?? 0) + quantity;
  const allowed = purchasableQuantity(variant);
  if (allowed <= 0) {
    throw new AppError('OUT_OF_STOCK', { details: { reasonCode: 'variant_out_of_stock' } });
  }
  // Clamp rather than refuse: an "add 5" that can only take 3 is more
  // useful as 3 plus an explanation than as an error and an empty basket.
  const finalQuantity = Math.min(requested, allowed);

  await db.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId: input.variantId } },
    create: { cartId: cart.id, variantId: input.variantId, quantity: finalQuantity },
    update: { quantity: finalQuantity },
  });
  await touch(cart.id);
}

export async function updateItemQuantity(
  owner: CartOwner,
  input: { variantId: string; quantity: number },
): Promise<void> {
  const quantity = assertQuantity(input.quantity, { allowZero: true });
  const cart = await findCart(owner);
  if (!cart) throw new AppError('NOT_FOUND', { details: { entity: 'Cart' } });

  // Zero is the natural "I don't want this any more" from a stepper that
  // counts down, so it removes rather than erroring.
  if (quantity === 0) {
    await removeItem(owner, input.variantId);
    return;
  }

  const item = await db.cartItem.findUnique({
    where: { cartId_variantId: { cartId: cart.id, variantId: input.variantId } },
    include: { variant: { include: { product: { select: { status: true, deletedAt: true } } } } },
  });
  if (!item) throw new AppError('NOT_FOUND', { details: { entity: 'CartItem' } });

  const allowed = purchasableQuantity(item.variant);
  if (allowed <= 0) {
    throw new AppError('OUT_OF_STOCK', { details: { reasonCode: 'variant_out_of_stock' } });
  }
  if (quantity > allowed) {
    throw new AppError('OUT_OF_STOCK', {
      details: { reasonCode: 'quantity_above_stock', available: allowed },
    });
  }

  await db.cartItem.update({
    where: { cartId_variantId: { cartId: cart.id, variantId: input.variantId } },
    data: { quantity },
  });
  await touch(cart.id);
}

export async function removeItem(owner: CartOwner, variantId: string): Promise<void> {
  const cart = await findCart(owner);
  if (!cart) return;
  await db.cartItem.deleteMany({ where: { cartId: cart.id, variantId } });
  await touch(cart.id);
}

export async function clearCart(owner: CartOwner): Promise<void> {
  const cart = await findCart(owner);
  if (!cart) return;
  await db.cartItem.deleteMany({ where: { cartId: cart.id } });
  await db.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
}

async function touch(cartId: string): Promise<void> {
  await db.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });
}

function assertQuantity(quantity: number, options: { allowZero: boolean }): number {
  const min = options.allowZero ? 0 : 1;
  if (!Number.isInteger(quantity) || quantity < min || quantity > MAX_LINE_QUANTITY) {
    throw new AppError('VALIDATION_FAILED', {
      details: { reasonCode: 'invalid_quantity' },
      internalMessage: `Quantity out of range: ${quantity}`,
    });
  }
  return quantity;
}

export { MAX_LINE_QUANTITY, variantInclude, isPurchasable };

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * Folds a guest cart into the customer's own, once, when a signed-in
 * customer turns up still holding a guest cookie.
 *
 * The rule is **max, not sum**, per variant. Summing is the other obvious
 * choice and it is worse in the two ways that matter: it surprises the
 * customer (2 added on a phone plus 3 added on a laptop becomes 5, which
 * neither of them asked for), and it is not idempotent, so a merge that runs
 * twice — a retried request, a double navigation — silently doubles the
 * basket. `max` can only ever produce a quantity the customer explicitly
 * chose somewhere, and running it again changes nothing.
 *
 * The guest cart is deleted afterwards, so the token in the cookie stops
 * referring to anything.
 */
export async function mergeGuestCartIntoCustomer(input: {
  guestToken: string;
  customerId: string;
}): Promise<{ merged: boolean }> {
  return db.$transaction(async (tx) => {
    const guestCart = await tx.cart.findUnique({
      where: { guestToken: input.guestToken },
      include: { items: true },
    });
    if (!guestCart) return { merged: false };

    const customerCart =
      (await tx.cart.findFirst({ where: { customerId: input.customerId } })) ??
      (await tx.cart.create({ data: { customerId: input.customerId } }));

    for (const item of guestCart.items) {
      const existing = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId: customerCart.id, variantId: item.variantId } },
      });
      const quantity = Math.max(item.quantity, existing?.quantity ?? 0);

      await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: customerCart.id, variantId: item.variantId } },
        create: { cartId: customerCart.id, variantId: item.variantId, quantity },
        update: { quantity },
      });
    }

    // A promotion the guest entered carries over only if the customer has
    // not already chosen one of their own — their explicit choice wins.
    if (guestCart.couponCode && !customerCart.couponCode) {
      await tx.cart.update({
        where: { id: customerCart.id },
        data: { couponCode: guestCart.couponCode },
      });
    }

    await tx.cart.delete({ where: { id: guestCart.id } });
    return { merged: true };
  });
}

// ---------------------------------------------------------------------------
// Coupon attachment
// ---------------------------------------------------------------------------

/** Stores the code only. Whether it is usable is decided on every read, so
 * attaching one never grants a discount by itself. */
export async function setCartCoupon(owner: CartOwner, code: string | null): Promise<void> {
  const cart = await getOrCreateCart(owner);
  await db.cart.update({ where: { id: cart.id }, data: { couponCode: code } });
}
