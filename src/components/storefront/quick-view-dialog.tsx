'use client';

import Link from 'next/link';
import { Eye } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ProductImage } from '@/components/commerce/product-image';
import { ProductPrice } from '@/components/commerce/product-price';
import { StockBadge, type StockStatus } from '@/components/commerce/stock-badge';
import type { Locale } from '@/modules/core/money';

export interface QuickViewDialogProps {
  href: string;
  name: string;
  brand?: string | null;
  image?: { src: string; alt: string } | null;
  priceMinor: number;
  compareAtMinor?: number | null;
  currency?: string;
  locale?: Locale;
  stockStatus?: StockStatus;
  triggerLabel: string;
  viewDetailsLabel: string;
  closeLabel: string;
}

/** A real quick-action, not a decorative button: opens the same data the
 * card already has (no extra fetch) in a dialog, with a link through to the
 * full product page — genuinely useful on a dense grid without leaving it. */
export function QuickViewDialog({
  href,
  name,
  brand,
  image,
  priceMinor,
  compareAtMinor,
  currency,
  locale,
  stockStatus,
  triggerLabel,
  viewDetailsLabel,
  closeLabel,
}: QuickViewDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          className="flex size-9 items-center justify-center rounded-(--radius-full) bg-(--color-surface)/90 text-(--color-text) shadow-(--shadow-sm) backdrop-blur-sm transition-colors duration-(--duration-fast) outline-none hover:bg-(--color-surface) focus-visible:ring-2 focus-visible:ring-(--color-ring)/25"
        >
          <Eye aria-hidden="true" className="size-4" />
        </button>
      </DialogTrigger>
      <DialogContent closeLabel={closeLabel} className="max-w-md">
        <DialogHeader>
          {brand ? (
            <p className="text-caption text-(--color-text-muted) uppercase">{brand}</p>
          ) : null}
          <p className="text-h5 font-semibold text-(--color-text)">{name}</p>
        </DialogHeader>

        <ProductImage src={image?.src} alt={image?.alt ?? name} sizes="400px" />

        <div className="flex items-center justify-between gap-2">
          <ProductPrice
            priceMinor={priceMinor}
            compareAtMinor={compareAtMinor}
            currency={currency}
            locale={locale}
          />
          {stockStatus ? <StockBadge status={stockStatus} locale={locale} /> : null}
        </div>

        <DialogFooter>
          <Button asChild variant="primary">
            <Link href={href}>{viewDetailsLabel}</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
