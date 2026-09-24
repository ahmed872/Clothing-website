import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';
import { createCategory } from '@/modules/catalog/category.service';
import { createProduct, publishProduct } from '@/modules/catalog/product.service';
import { resetCatalogTables } from '@/modules/catalog/testing';
import { adjustStock, setInventoryPolicy } from '@/modules/inventory';
import { createCoupon } from '@/modules/pricing/coupon.service';
import { resetPricingTables } from '@/modules/pricing/testing';

import {
  addItem,
  clearCart,
  getOrCreateCart,
  mergeGuestCartIntoCustomer,
  newGuestToken,
  purchasableQuantity,
  removeItem,
  setCartCoupon,
  updateItemQuantity,
} from './cart.service';
import { getCartItemCount, getCartView } from './cart-view.service';
import { resetCartTables } from './testing';

/**
 * The cart against a real database. What is being proved here is mostly
 * negative: that the server refuses what it should, and that nothing about
 * a price or an availability survives between requests.
 */

beforeEach(async () => {
  await resetCartTables();
  await resetPricingTables();
  await resetCatalogTables();
  await db.customer.deleteMany();
  await db.user.deleteMany();
});

async function shoes(options: { priceMinor?: number; stockQuantity?: number } = {}) {
  const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
  const product = await createProduct({
    product: {
      slug: 'runner',
      nameAr: 'حذاء الجري',
      nameEn: 'Running Shoe',
      categoryId: category.id,
    },
    variants: [
      {
        sku: 'RUN-BLK-41',
        priceMinor: options.priceMinor ?? 45_000,
        stockQuantity: options.stockQuantity ?? 10,
      },
    ],
  });
  await publishProduct(product.id);
  return { category, product, variant: product.variants[0]! };
}

async function guestOwner() {
  const guestToken = newGuestToken();
  await getOrCreateCart({ customerId: null, guestToken });
  return { customerId: null, guestToken };
}

async function customerOwner(email = 'shopper@example.com') {
  const user = await db.user.create({ data: { email, passwordHash: 'x', role: 'CUSTOMER' } });
  const customer = await db.customer.create({ data: { userId: user.id } });
  return { customerId: customer.id, guestToken: null };
}

describe('cart identity', () => {
  it('gives a guest a cart bound to their token and nobody else', async () => {
    const owner = await guestOwner();
    const { variant } = await shoes();
    await addItem(owner, { variantId: variant.id, quantity: 2 });

    expect((await getCartView(owner)).itemCount).toBe(2);

    // A different token is a different cart. The token is the credential.
    const other = { customerId: null, guestToken: newGuestToken() };
    expect((await getCartView(other)).itemCount).toBe(0);
  });

  it('keeps two customer carts apart', async () => {
    const a = await customerOwner('a@example.com');
    const b = await customerOwner('b@example.com');
    const { variant } = await shoes();

    await addItem(a, { variantId: variant.id, quantity: 3 });

    expect((await getCartView(a)).itemCount).toBe(3);
    expect((await getCartView(b)).itemCount).toBe(0);
  });

  it('an owner with neither identity gets an empty cart, never another one', async () => {
    const { variant } = await shoes();
    const owner = await guestOwner();
    await addItem(owner, { variantId: variant.id, quantity: 1 });

    const anonymous = { customerId: null, guestToken: null };
    expect((await getCartView(anonymous)).itemCount).toBe(0);
  });

  it('issues guest tokens with real entropy', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => newGuestToken()));
    expect(tokens.size).toBe(50);
    expect(newGuestToken().length).toBeGreaterThanOrEqual(42);
  });
});

describe('addItem', () => {
  it('adds a line and totals it from the catalog price', async () => {
    const owner = await guestOwner();
    const { variant } = await shoes({ priceMinor: 45_000 });

    await addItem(owner, { variantId: variant.id, quantity: 2 });

    const view = await getCartView(owner);
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]!.unitPriceMinor).toBe(45_000);
    expect(view.subtotalMinor).toBe(90_000);
    expect(view.totalMinor).toBe(90_000);
  });

  it('adding the same variant twice accumulates instead of duplicating the line', async () => {
    const owner = await guestOwner();
    const { variant } = await shoes();

    await addItem(owner, { variantId: variant.id, quantity: 2 });
    await addItem(owner, { variantId: variant.id, quantity: 3 });

    const view = await getCartView(owner);
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]!.quantity).toBe(5);
  });

  it('refuses a variant that does not exist', async () => {
    const owner = await guestOwner();
    await expect(
      addItem(owner, { variantId: '00000000-0000-4000-8000-000000000000', quantity: 1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a variant whose product is not published', async () => {
    const owner = await guestOwner();
    const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
    const draft = await createProduct({
      product: { slug: 'draft', nameAr: 'مسودة', nameEn: 'Draft', categoryId: category.id },
      variants: [{ sku: 'DRAFT-1', priceMinor: 1_000, stockQuantity: 5 }],
    });

    await expect(
      addItem(owner, { variantId: draft.variants[0]!.id, quantity: 1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses an out-of-stock variant', async () => {
    const owner = await guestOwner();
    const { variant } = await shoes({ stockQuantity: 0 });

    await expect(addItem(owner, { variantId: variant.id, quantity: 1 })).rejects.toMatchObject({
      code: 'OUT_OF_STOCK',
    });
  });

  it('clamps to what is actually in stock rather than refusing outright', async () => {
    const owner = await guestOwner();
    const { variant } = await shoes({ stockQuantity: 3 });

    await addItem(owner, { variantId: variant.id, quantity: 10 });

    const view = await getCartView(owner);
    expect(view.lines[0]!.quantity).toBe(3);
  });

  it('rejects a zero, negative or fractional quantity', async () => {
    const owner = await guestOwner();
    const { variant } = await shoes();

    for (const quantity of [0, -1, 1.5, 1_000]) {
      await expect(addItem(owner, { variantId: variant.id, quantity })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
  });

  it('an untracked variant is always buyable, whatever its counter says', async () => {
    const owner = await guestOwner();
    const { variant } = await shoes({ stockQuantity: 0 });
    await setInventoryPolicy(variant.id, { trackInventory: false });

    await addItem(owner, { variantId: variant.id, quantity: 4 });
    expect((await getCartView(owner)).lines[0]!.quantity).toBe(4);
  });
});

describe('updateItemQuantity / removeItem / clearCart', () => {
  it('updates a quantity', async () => {
    const owner = await guestOwner();
    const { variant } = await shoes();
    await addItem(owner, { variantId: variant.id, quantity: 1 });

    await updateItemQuantity(owner, { variantId: variant.id, quantity: 4 });
    expect((await getCartView(owner)).lines[0]!.quantity).toBe(4);
  });

  it('treats zero as a removal', async () => {
    const owner = await guestOwner();
    const { variant } = await shoes();
    await addItem(owner, { variantId: variant.id, quantity: 2 });

    await updateItemQuantity(owner, { variantId: variant.id, quantity: 0 });
    expect((await getCartView(owner)).lines).toHaveLength(0);
  });

  it('refuses a quantity above available stock', async () => {
    const owner = await guestOwner();
    const { variant } = await shoes({ stockQuantity: 2 });
    await addItem(owner, { variantId: variant.id, quantity: 1 });

    await expect(
      updateItemQuantity(owner, { variantId: variant.id, quantity: 9 }),
    ).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });
    expect((await getCartView(owner)).lines[0]!.quantity).toBe(1);
  });

  it('removes a line and clears the whole cart', async () => {
    const owner = await guestOwner();
    const { variant } = await shoes();
    await addItem(owner, { variantId: variant.id, quantity: 2 });

    await removeItem(owner, variant.id);
    expect((await getCartView(owner)).lines).toHaveLength(0);

    await addItem(owner, { variantId: variant.id, quantity: 2 });
    await clearCart(owner);
    expect((await getCartView(owner)).itemCount).toBe(0);
  });

  it('clearing also drops the promotion', async () => {
    const owner = await guestOwner();
    const { variant } = await shoes();
    await createCoupon({ code: 'SAVE10', type: 'PERCENTAGE', value: 10 });
    await addItem(owner, { variantId: variant.id, quantity: 1 });
    await setCartCoupon(owner, 'SAVE10');

    await clearCart(owner);
    expect((await getCartView(owner)).coupon).toBeNull();
  });
});

describe('the cart never guarantees a price or an availability', () => {
  it('quotes the current price, not the price when the item was added', async () => {
    const owner = await guestOwner();
    const { variant } = await shoes({ priceMinor: 45_000 });
    await addItem(owner, { variantId: variant.id, quantity: 2 });
    expect((await getCartView(owner)).subtotalMinor).toBe(90_000);

    await db.variant.update({ where: { id: variant.id }, data: { priceMinor: 50_000 } });

    const view = await getCartView(owner);
    expect(view.lines[0]!.unitPriceMinor).toBe(50_000);
    expect(view.subtotalMinor).toBe(100_000);
  });

  it('reduces a line when stock has fallen, and says that it did', async () => {
    const owner = await guestOwner();
    const { variant } = await shoes({ stockQuantity: 10 });
    await addItem(owner, { variantId: variant.id, quantity: 6 });

    await adjustStock({ variantId: variant.id, setTo: 2, reason: 'CORRECTION' });

    const view = await getCartView(owner);
    expect(view.lines[0]!.quantity).toBe(2);
    expect(view.lines[0]!.requestedQuantity).toBe(6);
    expect(view.lines[0]!.issues).toContain('quantity_reduced');
    expect(view.subtotalMinor).toBe(90_000);
  });

  it('marks a line out of stock and charges nothing for it', async () => {
    const owner = await guestOwner();
    const { variant } = await shoes({ stockQuantity: 5 });
    await addItem(owner, { variantId: variant.id, quantity: 3 });

    await adjustStock({ variantId: variant.id, setTo: 0, reason: 'CORRECTION' });

    const view = await getCartView(owner);
    expect(view.lines[0]!.issues).toContain('out_of_stock');
    expect(view.lines[0]!.lineTotalMinor).toBe(0);
    expect(view.totalMinor).toBe(0);
  });

  it('drops a line whose product was unpublished, and names it', async () => {
    const owner = await guestOwner();
    const { variant, product } = await shoes();
    await addItem(owner, { variantId: variant.id, quantity: 1 });

    await db.product.update({ where: { id: product.id }, data: { status: 'ARCHIVED' } });

    const view = await getCartView(owner);
    expect(view.lines).toHaveLength(0);
    expect(view.removedLines).toHaveLength(1);
    expect(view.removedLines[0]!.sku).toBe('RUN-BLK-41');
    expect(view.totalMinor).toBe(0);
  });

  it('follows a sale price the same way the storefront does', async () => {
    const owner = await guestOwner();
    const { variant } = await shoes({ priceMinor: 45_000 });
    await addItem(owner, { variantId: variant.id, quantity: 1 });

    await db.variant.update({
      where: { id: variant.id },
      data: { salePriceMinor: 30_000, saleStartsAt: null, saleEndsAt: null },
    });

    const view = await getCartView(owner);
    expect(view.lines[0]!.unitPriceMinor).toBe(30_000);
    expect(view.lines[0]!.compareAtMinor).toBe(45_000);
  });
});

describe('guest → customer merge', () => {
  it('moves the guest lines into the customer cart', async () => {
    const guest = await guestOwner();
    const customer = await customerOwner();
    const { variant } = await shoes();

    await addItem(guest, { variantId: variant.id, quantity: 2 });
    await mergeGuestCartIntoCustomer({
      guestToken: guest.guestToken!,
      customerId: customer.customerId!,
    });

    expect((await getCartView(customer)).itemCount).toBe(2);
    // The guest cart is gone, so the cookie token now refers to nothing.
    expect((await getCartView(guest)).itemCount).toBe(0);
  });

  it('takes the larger quantity rather than summing', async () => {
    const guest = await guestOwner();
    const customer = await customerOwner();
    const { variant } = await shoes();

    await addItem(customer, { variantId: variant.id, quantity: 3 });
    await addItem(guest, { variantId: variant.id, quantity: 2 });

    await mergeGuestCartIntoCustomer({
      guestToken: guest.guestToken!,
      customerId: customer.customerId!,
    });

    // Not 5: neither device asked for 5.
    expect((await getCartView(customer)).lines[0]!.quantity).toBe(3);
  });

  it('is idempotent — running it twice changes nothing', async () => {
    const guest = await guestOwner();
    const customer = await customerOwner();
    const { variant } = await shoes();
    await addItem(guest, { variantId: variant.id, quantity: 2 });

    const token = guest.guestToken!;
    await mergeGuestCartIntoCustomer({ guestToken: token, customerId: customer.customerId! });
    const second = await mergeGuestCartIntoCustomer({
      guestToken: token,
      customerId: customer.customerId!,
    });

    expect(second.merged).toBe(false);
    expect((await getCartView(customer)).lines[0]!.quantity).toBe(2);
  });

  it('carries a guest promotion over only when the customer has none', async () => {
    await createCoupon({ code: 'GUEST10', type: 'PERCENTAGE', value: 10 });
    await createCoupon({ code: 'MINE20', type: 'PERCENTAGE', value: 20 });
    const { variant } = await shoes();

    const guestA = await guestOwner();
    const customerA = await customerOwner('one@example.com');
    await addItem(guestA, { variantId: variant.id, quantity: 1 });
    await setCartCoupon(guestA, 'GUEST10');
    await mergeGuestCartIntoCustomer({
      guestToken: guestA.guestToken!,
      customerId: customerA.customerId!,
    });
    expect((await getCartView(customerA)).coupon?.code).toBe('GUEST10');

    const guestB = await guestOwner();
    const customerB = await customerOwner('two@example.com');
    await addItem(customerB, { variantId: variant.id, quantity: 1 });
    await setCartCoupon(customerB, 'MINE20');
    await addItem(guestB, { variantId: variant.id, quantity: 1 });
    await setCartCoupon(guestB, 'GUEST10');
    await mergeGuestCartIntoCustomer({
      guestToken: guestB.guestToken!,
      customerId: customerB.customerId!,
    });
    // The customer's own explicit choice wins.
    expect((await getCartView(customerB)).coupon?.code).toBe('MINE20');
  });
});

describe('purchasableQuantity', () => {
  it('is the stock level when tracked, and unbounded-ish when not', () => {
    expect(purchasableQuantity({ trackInventory: true, stockQuantity: 4 })).toBe(4);
    expect(purchasableQuantity({ trackInventory: true, stockQuantity: 0 })).toBe(0);
    expect(purchasableQuantity({ trackInventory: true, stockQuantity: -3 })).toBe(0);
    expect(purchasableQuantity({ trackInventory: false, stockQuantity: 0 })).toBeGreaterThan(0);
  });
});

describe('getCartItemCount', () => {
  it('sums the quantities', async () => {
    const owner = await guestOwner();
    const { variant } = await shoes();
    await addItem(owner, { variantId: variant.id, quantity: 3 });
    expect(await getCartItemCount(owner)).toBe(3);
  });

  it('is zero for someone with no cart', async () => {
    expect(await getCartItemCount({ customerId: null, guestToken: newGuestToken() })).toBe(0);
  });
});

describe('concurrent cart updates', () => {
  it('two simultaneous adds of the same variant settle on one coherent line', async () => {
    const owner = await guestOwner();
    const { variant } = await shoes({ stockQuantity: 50 });

    // The unique index on (cartId, variantId) is what makes this safe: the
    // upserts serialise on it rather than producing two rows for the same
    // variant, which would show the customer a duplicated product.
    const results = await Promise.allSettled([
      addItem(owner, { variantId: variant.id, quantity: 2 }),
      addItem(owner, { variantId: variant.id, quantity: 3 }),
    ]);

    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    const view = await getCartView(owner);
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]!.quantity).toBeGreaterThan(0);
    expect(view.lines[0]!.quantity).toBeLessThanOrEqual(5);
  });

  it('concurrent adds of different variants both land', async () => {
    const owner = await guestOwner();
    const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });

    // Two single-variant products: a product with no options must have
    // exactly one variant, which is the catalog's own rule.
    const made = [];
    for (const [index, priceMinor] of [10_000, 20_000].entries()) {
      const product = await createProduct({
        product: {
          slug: `multi-${index}`,
          nameAr: 'متعدد',
          nameEn: 'Multi',
          categoryId: category.id,
        },
        variants: [{ sku: `M-${index}`, priceMinor, stockQuantity: 5 }],
      });
      await publishProduct(product.id);
      made.push(product.variants[0]!);
    }

    await Promise.all([
      addItem(owner, { variantId: made[0]!.id, quantity: 1 }),
      addItem(owner, { variantId: made[1]!.id, quantity: 2 }),
    ]);

    const view = await getCartView(owner);
    expect(view.lines).toHaveLength(2);
    expect(view.itemCount).toBe(3);
    expect(view.subtotalMinor).toBe(10_000 + 2 * 20_000);
  });

  it('a cart never exceeds available stock, even under concurrent adds', async () => {
    const owner = await guestOwner();
    const { variant } = await shoes({ stockQuantity: 4 });

    await Promise.allSettled([
      addItem(owner, { variantId: variant.id, quantity: 3 }),
      addItem(owner, { variantId: variant.id, quantity: 3 }),
    ]);

    const view = await getCartView(owner);
    // Whatever interleaving happened, the recalculation on read is what the
    // customer sees, and it can never be more than the shelf holds.
    expect(view.lines[0]!.quantity).toBeLessThanOrEqual(4);
  });
});
