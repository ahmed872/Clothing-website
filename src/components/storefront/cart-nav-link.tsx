'use client';

import * as React from 'react';
import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';

import { getCartCountAction } from '@/lib/cart/cart-actions';
import { CART_CHANGED_EVENT } from '@/components/storefront/cart/cart-events';
import type { Locale } from '@/lib/i18n/locales';
import { Button } from '@/components/ui/button';

/**
 * The cart entry point, and a live count of what is in it.
 *
 * The count is fetched on the client rather than rendered by the layout on
 * purpose: reading the cart needs the session or the guest cookie, and doing
 * that in the storefront layout would make every cached category and product
 * page dynamic. Keeping it here costs one small request and leaves P05's ISR
 * intact (P09 §23).
 *
 * It re-reads whenever something else on the page changes the cart, so
 * adding from a product page updates the badge without a navigation.
 */
export function CartNavLink({ locale, label }: { locale: Locale; label: string }) {
  const [count, setCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const load = () => {
      void getCartCountAction()
        .then((value) => {
          if (!cancelled) setCount(value);
        })
        // A badge that cannot load is not worth surfacing an error for; the
        // cart page itself reports anything that actually matters.
        .catch(() => undefined);
    };

    load();
    window.addEventListener(CART_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(CART_CHANGED_EVENT, load);
    };
  }, []);

  return (
    <Button asChild variant="ghost" size="icon" aria-label={label} className="relative">
      <Link href={`/${locale}/cart`}>
        <ShoppingBag aria-hidden="true" />
        {count !== null && count > 0 ? (
          <span
            // `dir="ltr"` and Latin digits: a count is a number, and it
            // reads identically in both languages (ADR-023).
            dir="ltr"
            className="absolute -top-0.5 -end-0.5 flex min-w-4.5 items-center justify-center rounded-(--radius-full) bg-(--color-primary) px-1 text-[0.625rem] leading-4 font-medium text-(--color-primary-foreground) tabular-nums"
          >
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}
