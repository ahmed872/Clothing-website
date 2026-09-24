import { db, DEFAULT_CURRENCY } from '@/modules/core';
import {
  resolveEffectivePrice,
  resolveVariantStockStatus,
  type StockStatus,
} from '@/modules/catalog';
import { getMediaPublicUrl, type ResolvedMediaImage } from '@/modules/media';
import {
  calculateCart,
  evaluateCouponForCart,
  type CartPricing,
  type CouponRejection,
  type PricingLineInput,
} from '@/modules/pricing';

import { findCart, purchasableQuantity, type CartOwner } from './cart.service';

/**
 * Reading a cart is a recalculation, not a lookup (P09 §16/§17).
 *
 * A cart stores two things per line: which variant, and how many. The price,
 * the availability and the discount are all derived here, from the catalog
 * and the promotion as they are *now*. So a cart that has sat open for a
 * week cannot quote last week's price, and a client that replays an old
 * payload cannot make it.
 *
 * Where the recalculation changed something the customer had already seen,
 * the line says so — an adjustment they are not told about is the thing
 * §15 exists to prevent.
 */

export type CartLineIssue = 'unavailable' | 'out_of_stock' | 'quantity_reduced';

export interface CartLineView {
  variantId: string;
  productId: string;
  productSlug: string;
  productNameAr: string;
  productNameEn: string;
  variantLabelAr: string | null;
  variantLabelEn: string | null;
  sku: string;
  /** Already resolved to a public URL by `media` — the presentation layer
   * renders it, it does not build it. */
  image: ResolvedMediaImage | null;
  quantity: number;
  /** What the customer asked for, when that is more than they can have. */
  requestedQuantity: number;
  unitPriceMinor: number;
  compareAtMinor: number | null;
  lineSubtotalMinor: number;
  lineDiscountMinor: number;
  lineTotalMinor: number;
  discountEligible: boolean;
  stockStatus: StockStatus;
  availableQuantity: number;
  issues: CartLineIssue[];
}

export interface CartCouponView {
  code: string;
  applied: boolean;
  /** Present when the code is attached but could not be used this time. */
  rejection: CouponRejection | null;
  minOrderMinor: number | null;
  descriptionAr: string | null;
  descriptionEn: string | null;
}

export interface CartView {
  lines: CartLineView[];
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  itemCount: number;
  coupon: CartCouponView | null;
  /** Lines dropped entirely because the product is no longer for sale. */
  removedLines: { productNameAr: string; productNameEn: string; sku: string }[];
}

export const EMPTY_CART: CartView = {
  lines: [],
  currency: DEFAULT_CURRENCY,
  subtotalMinor: 0,
  discountMinor: 0,
  totalMinor: 0,
  itemCount: 0,
  coupon: null,
  removedLines: [],
};

function composeLabel(
  links: {
    optionValue: {
      valueAr: string;
      valueEn: string;
      position: number;
      option: { position: number };
    };
  }[],
  locale: 'ar' | 'en',
): string | null {
  if (links.length === 0) return null;
  return links
    .map((link) => link.optionValue)
    .sort((a, b) => a.option.position - b.option.position || a.position - b.position)
    .map((value) => (locale === 'ar' ? value.valueAr : value.valueEn))
    .join(' / ');
}

export async function getCartView(
  owner: CartOwner,
  options: { now?: Date } = {},
): Promise<CartView> {
  const cart = await findCart(owner);
  if (!cart) return EMPTY_CART;

  const now = options.now ?? new Date();

  // One query for every line, with the product and options it needs — not
  // one query per line.
  const items = await db.cartItem.findMany({
    where: { cartId: cart.id },
    orderBy: { createdAt: 'asc' },
    include: {
      variant: {
        include: {
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
              images: { orderBy: { position: 'asc' }, take: 1, include: { media: true } },
            },
          },
          optionValues: { include: { optionValue: { include: { option: true } } } },
        },
      },
    },
  });

  const removedLines: CartView['removedLines'] = [];
  const kept: typeof items = [];

  for (const item of items) {
    const { product } = item.variant;
    if (product.status !== 'PUBLISHED' || product.deletedAt !== null) {
      removedLines.push({
        productNameAr: product.nameAr,
        productNameEn: product.nameEn,
        sku: item.variant.sku,
      });
      continue;
    }
    kept.push(item);
  }

  const prepared = kept.map((item) => {
    const price = resolveEffectivePrice(item.variant, now);
    const available = purchasableQuantity(item.variant);
    const quantity = Math.min(item.quantity, available);
    const issues: CartLineIssue[] = [];
    if (available <= 0) issues.push('out_of_stock');
    else if (quantity < item.quantity) issues.push('quantity_reduced');

    return { item, price, available, quantity, issues };
  });

  // Lines that cannot be bought at all contribute nothing to the totals —
  // charging for something the store cannot ship would be worse than
  // showing a zero next to a clear explanation.
  const pricingLines: PricingLineInput[] = prepared
    .filter((entry) => entry.quantity > 0)
    .map((entry) => ({
      variantId: entry.item.variantId,
      productId: entry.item.variant.product.id,
      categoryId: entry.item.variant.product.categoryId,
      brandId: entry.item.variant.product.brandId,
      quantity: entry.quantity,
      unitPriceMinor: entry.price.currentMinor,
    }));

  let couponView: CartCouponView | null = null;
  let appliedCoupon: Parameters<typeof calculateCart>[0]['coupon'] = null;

  if (cart.couponCode) {
    const { coupon, evaluation } = await evaluateCouponForCart({
      code: cart.couponCode,
      lines: pricingLines,
      customerId: cart.customerId,
      now,
    });

    couponView = {
      code: cart.couponCode,
      applied: evaluation.ok,
      rejection: evaluation.ok ? null : evaluation.reason,
      minOrderMinor:
        !evaluation.ok && evaluation.reason === 'below_minimum'
          ? (evaluation.minOrderMinor ?? null)
          : null,
      descriptionAr: coupon?.descriptionAr ?? null,
      descriptionEn: coupon?.descriptionEn ?? null,
    };

    if (coupon && evaluation.ok) {
      appliedCoupon = {
        id: coupon.id,
        code: coupon.code,
        type: coupon.type,
        value: coupon.value,
        maxDiscountMinor: coupon.maxDiscountMinor,
        eligibleVariantIds: evaluation.eligibleVariantIds,
      };
    }
  }

  const pricing: CartPricing = calculateCart({ lines: pricingLines, coupon: appliedCoupon });
  const byVariant = new Map(pricing.lines.map((line) => [line.variantId, line]));

  const lines: CartLineView[] = prepared.map((entry) => {
    const priced = byVariant.get(entry.item.variantId);
    const image = entry.item.variant.product.images[0];
    const product = entry.item.variant.product;

    return {
      variantId: entry.item.variantId,
      productId: entry.item.variant.product.id,
      productSlug: entry.item.variant.product.slug,
      productNameAr: entry.item.variant.product.nameAr,
      productNameEn: entry.item.variant.product.nameEn,
      variantLabelAr:
        entry.item.variant.labelAr ?? composeLabel(entry.item.variant.optionValues, 'ar'),
      variantLabelEn:
        entry.item.variant.labelEn ?? composeLabel(entry.item.variant.optionValues, 'en'),
      sku: entry.item.variant.sku,
      image: image
        ? {
            src: getMediaPublicUrl(image.media),
            alt: image.media.altAr ?? product.nameAr,
            width: image.media.width,
            height: image.media.height,
          }
        : null,
      quantity: entry.quantity,
      requestedQuantity: entry.item.quantity,
      unitPriceMinor: entry.price.currentMinor,
      compareAtMinor: entry.price.compareAtMinor,
      lineSubtotalMinor: priced?.lineSubtotalMinor ?? 0,
      lineDiscountMinor: priced?.lineDiscountMinor ?? 0,
      lineTotalMinor: priced?.lineTotalMinor ?? 0,
      discountEligible: priced?.discountEligible ?? false,
      stockStatus: resolveVariantStockStatus(entry.item.variant),
      availableQuantity: entry.available,
      issues: entry.issues,
    };
  });

  return {
    lines,
    currency: pricing.currency,
    subtotalMinor: pricing.subtotalMinor,
    discountMinor: pricing.discountMinor,
    totalMinor: pricing.totalMinor,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    coupon: couponView,
    removedLines,
  };
}

/** Just the badge number for the header, without assembling a whole view. */
export async function getCartItemCount(owner: CartOwner): Promise<number> {
  const cart = await findCart(owner);
  if (!cart) return 0;
  const result = await db.cartItem.aggregate({
    where: { cartId: cart.id },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}
