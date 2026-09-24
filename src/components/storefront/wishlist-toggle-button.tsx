'use client';

import { Heart } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useWishlist } from '@/lib/wishlist';

export interface WishlistToggleButtonProps {
  productId: string;
  addLabel: string;
  removeLabel: string;
  className?: string;
}

/** A small, self-contained client island — every other piece of a product
 * card/grid can stay a Server Component. */
export function WishlistToggleButton({
  productId,
  addLabel,
  removeLabel,
  className,
}: WishlistToggleButtonProps) {
  const { ids, toggle } = useWishlist();
  const active = ids.includes(productId);

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? removeLabel : addLabel}
      onClick={(event) => {
        event.preventDefault();
        toggle(productId);
      }}
      className={cn(
        'flex size-9 items-center justify-center rounded-(--radius-full) bg-(--color-surface)/90 text-(--color-text) ' +
          'shadow-(--shadow-sm) backdrop-blur-sm transition-colors duration-(--duration-fast) outline-none',
        'hover:bg-(--color-surface) focus-visible:ring-2 focus-visible:ring-(--color-ring)/25',
        active && 'text-(--color-error)',
        className,
      )}
    >
      <Heart aria-hidden="true" className={cn('size-4', active && 'fill-current')} />
    </button>
  );
}
