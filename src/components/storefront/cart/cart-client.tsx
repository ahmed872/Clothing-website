'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Loader2, ShoppingBag, Trash2, X } from 'lucide-react';

import type { CartView } from '@/modules/cart';
import { formatMoney } from '@/modules/core/money';
import type { Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import {
  applyCouponAction,
  clearCartAction,
  removeCouponAction,
  removeFromCartAction,
  updateCartQuantityAction,
} from '@/lib/cart/cart-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { QuantitySelector } from '@/components/commerce/quantity-selector';
import { toast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * The cart, rendered from server truth.
 *
 * Every mutation returns the recalculated cart and this component replaces
 * its state with it wholesale. Nothing is computed here — not a line total,
 * not a subtotal, not a discount. A number the browser worked out for
 * itself would be a second pricing implementation, and the two would
 * eventually disagree (P09 §24).
 */
export function CartClient({
  initialCart,
  locale,
  currency,
}: {
  initialCart: CartView;
  locale: Locale;
  currency: string;
}) {
  const t = getDictionary(locale).cart;
  const [cart, setCart] = React.useState(initialCart);
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const [couponError, setCouponError] = React.useState<string | null>(null);
  const [confirmClear, setConfirmClear] = React.useState(false);

  const money = (minor: number) => formatMoney(minor, { locale, currency });

  /**
   * Checkout is blocked while a mutation is in flight, and while any line
   * carries an issue — an out-of-stock or reduced line is exactly what the
   * server refuses at order creation, so sending the customer through the
   * address form first would waste their time to reach the same answer.
   */
  const checkoutBlocked = pending !== null || cart.lines.some((line) => line.issues.length > 0);

  async function run(
    key: string,
    action: () => Promise<{ ok: boolean; data?: CartView; error?: string }>,
  ): Promise<boolean> {
    setPending(key);
    setError(null);
    const result = await action();
    setPending(null);

    if (!result.ok) {
      setError(result.error ?? null);
      return false;
    }
    if (result.data) setCart(result.data);
    return true;
  }

  if (cart.lines.length === 0 && cart.removedLines.length === 0) {
    return (
      <EmptyState
        title={t.empty}
        description={t.emptyDescription}
        action={
          <Button asChild>
            <Link href={`/${locale}`}>{t.continueShopping}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {error ? (
          <Alert variant="error" role="alert">
            {error}
          </Alert>
        ) : null}

        {cart.removedLines.length > 0 ? (
          <Alert variant="warning" role="status" title={t.removedTitle}>
            <ul className="mt-1 flex flex-col gap-0.5">
              {cart.removedLines.map((removed) => (
                <li key={removed.sku}>
                  {t.removedLine
                    .replace(
                      '{name}',
                      locale === 'ar' ? removed.productNameAr : removed.productNameEn,
                    )
                    .replace('{sku}', removed.sku)}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}

        <ul className="flex flex-col gap-4">
          {cart.lines.map((line) => {
            const name = locale === 'ar' ? line.productNameAr : line.productNameEn;
            const variantLabel = locale === 'ar' ? line.variantLabelAr : line.variantLabelEn;
            const busy = pending === `line:${line.variantId}`;

            return (
              <li
                key={line.variantId}
                className="flex gap-4 rounded-(--radius-surface) border border-(--color-border) bg-(--color-surface) p-4"
              >
                {/* The image links to the same place as the name below it.
                    Hidden from assistive technology and skipped by the
                    keyboard so the line offers one link, not two identical
                    ones a screen-reader user has to hear twice. */}
                <Link
                  href={`/${locale}/p/${line.productSlug}`}
                  aria-hidden="true"
                  tabIndex={-1}
                  className="shrink-0 overflow-hidden rounded-(--radius-control) bg-(--color-surface-raised)"
                >
                  {line.image ? (
                    <Image
                      src={line.image.src}
                      alt={line.image.alt}
                      width={96}
                      height={96}
                      className="size-24 object-cover"
                    />
                  ) : (
                    <span className="flex size-24 items-center justify-center text-(--color-text-subtle)">
                      <ShoppingBag className="size-6" aria-hidden="true" />
                    </span>
                  )}
                </Link>

                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/${locale}/p/${line.productSlug}`}
                        className="text-body font-medium text-(--color-text) hover:underline"
                      >
                        {name}
                      </Link>
                      {variantLabel ? (
                        <p className="text-small text-(--color-text-muted)">{variantLabel}</p>
                      ) : null}
                      {/* A SKU is a code: one LTR run in both languages. */}
                      <p dir="ltr" className="text-caption text-(--color-text-muted) tabular-nums">
                        {line.sku}
                      </p>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t.removeLabel.replace('{name}', name)}
                      disabled={busy}
                      onClick={() =>
                        void run(`line:${line.variantId}`, () =>
                          removeFromCartAction(line.variantId, locale),
                        )
                      }
                    >
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </div>

                  {line.issues.includes('out_of_stock') ? (
                    <p role="status" className="text-small text-(--color-error)">
                      {t.lineOutOfStock}
                    </p>
                  ) : null}
                  {line.issues.includes('quantity_reduced') ? (
                    <p role="status" className="text-small text-(--color-warning)">
                      {t.lineQuantityReduced.replace('{count}', String(line.availableQuantity))}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <QuantitySelector
                      value={line.quantity}
                      max={Math.max(1, line.availableQuantity)}
                      disabled={busy || line.availableQuantity <= 0}
                      decreaseLabel={t.decrease}
                      increaseLabel={t.increase}
                      onChange={(quantity) =>
                        void run(`line:${line.variantId}`, () =>
                          updateCartQuantityAction({ variantId: line.variantId, quantity }, locale),
                        )
                      }
                    />

                    <div className="text-end">
                      <p className="text-caption text-(--color-text-muted)">
                        {money(line.unitPriceMinor)}
                      </p>
                      <p className="text-body font-medium text-(--color-text) tabular-nums">
                        {money(line.lineTotalMinor)}
                      </p>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="ghost">
            <Link href={`/${locale}`}>{t.continueShopping}</Link>
          </Button>
          {cart.lines.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending !== null}
              onClick={() => setConfirmClear(true)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {t.clear}
            </Button>
          ) : null}
        </div>
      </div>

      <aside className="w-full shrink-0 lg:w-80">
        <div className="flex flex-col gap-4 rounded-(--radius-surface) border border-(--color-border) bg-(--color-surface) p-5">
          <h2 className="text-h6 text-(--color-text)">{t.summary}</h2>

          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setCouponError(null);
              void (async () => {
                setPending('coupon');
                const result = await applyCouponAction(code, locale);
                setPending(null);
                if (!result.ok) {
                  setCouponError(result.error ?? null);
                  return;
                }
                if (result.data) setCart(result.data);
                setCode('');
                toast({
                  title: t.promoApplied.replace('{code}', result.data?.coupon?.code ?? ''),
                  variant: 'success',
                });
              })();
            }}
          >
            <label htmlFor="promo-code" className="text-small font-medium text-(--color-text)">
              {t.promoTitle}
            </label>

            {cart.coupon?.applied ? (
              <div className="flex items-center justify-between gap-2 rounded-(--radius-control) bg-(--color-success-surface) px-3 py-2">
                <span dir="ltr" className="text-small font-medium text-(--color-text)">
                  {cart.coupon.code}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending !== null}
                  onClick={() => void run('coupon', () => removeCouponAction(locale))}
                >
                  {t.promoRemove}
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  id="promo-code"
                  name="promo-code"
                  value={code}
                  dir="ltr"
                  autoComplete="off"
                  placeholder={t.promoPlaceholder}
                  onChange={(event) => setCode(event.target.value)}
                  aria-describedby={couponError ? 'promo-error' : undefined}
                  aria-invalid={couponError ? true : undefined}
                />
                <Button type="submit" variant="outline" disabled={pending === 'coupon'}>
                  {pending === 'coupon' ? t.promoApplying : t.promoApply}
                </Button>
              </div>
            )}

            {couponError ? (
              <p id="promo-error" role="alert" className="text-small text-(--color-error)">
                {couponError}
              </p>
            ) : null}
          </form>

          <dl className="flex flex-col gap-2 border-t border-(--color-border) pt-4">
            <div className="flex items-center justify-between">
              <dt className="text-small text-(--color-text-muted)">{t.subtotal}</dt>
              <dd className="text-body text-(--color-text) tabular-nums">
                {money(cart.subtotalMinor)}
              </dd>
            </div>
            {cart.discountMinor > 0 ? (
              <div className="flex items-center justify-between">
                <dt className="text-small text-(--color-success)">{t.discount}</dt>
                <dd dir="ltr" className="text-body text-(--color-success) tabular-nums">
                  −{money(cart.discountMinor)}
                </dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between border-t border-(--color-border) pt-2">
              <dt className="text-body font-medium text-(--color-text)">{t.total}</dt>
              <dd className="text-h6 text-(--color-text) tabular-nums">{money(cart.totalMinor)}</dd>
            </div>
          </dl>

          <p className="text-caption text-(--color-text-muted)">{t.priceChangedNotice}</p>

          {/* P10: checkout exists. Disabled while a cart mutation is in
              flight, so nobody carries a half-applied change into it, and
              blocked entirely when a line cannot be bought — the server
              would refuse that order anyway, and refusing it here explains
              why instead of failing after the address is typed. */}
          <Button
            asChild={!checkoutBlocked}
            className="w-full"
            disabled={checkoutBlocked}
            aria-disabled={checkoutBlocked || undefined}
          >
            {checkoutBlocked ? (
              <span>
                {pending !== null ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                {t.checkout}
              </span>
            ) : (
              <Link href={`/${locale}/checkout`}>{t.checkout}</Link>
            )}
          </Button>
        </div>
      </aside>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t.clearConfirmTitle}</DialogTitle>
            <DialogDescription>{t.clearConfirmBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmClear(false)}>
              {t.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending !== null}
              onClick={() =>
                void (async () => {
                  const ok = await run('clear', () => clearCartAction(locale));
                  if (ok) setConfirmClear(false);
                })()
              }
            >
              {t.clear}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
