'use client';

import Link from 'next/link';
import { Heart } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useWishlist } from '@/lib/wishlist';
import type { Locale } from '@/lib/i18n/locales';

export function WishlistNavLink({ locale, label }: { locale: Locale; label: string }) {
  const { ids } = useWishlist();

  return (
    <Button asChild variant="ghost" size="icon" aria-label={label} className="relative">
      <Link href={`/${locale}/wishlist`}>
        <Heart aria-hidden="true" />
        {ids.length > 0 ? (
          <span
            className="tabular-nums absolute top-0.5 end-0.5 flex size-4 items-center justify-center rounded-(--radius-full) bg-(--color-accent) text-[10px] font-semibold text-(--color-accent-foreground)"
            aria-hidden="true"
          >
            {ids.length > 9 ? '9+' : ids.length}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}
