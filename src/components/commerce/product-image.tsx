'use client';

import * as React from 'react';
import Image from 'next/image';
import { ImageOff } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface ProductImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  /** Shown in place of the image when `src` is empty, or when it fails to
   * load. Defaults to Arabic (the store default locale). */
  noImageLabel?: string;
}

/**
 * A single product image with a fixed 1:1 frame and a token-styled fallback
 * — when no image exists yet (the common state for a product mid-catalog-
 * entry) *or* when a real `src` fails to load at request time. That second
 * case is deliberate, not defensive filler: `MediaAsset` rows migrated from
 * an external URL before their bytes were ever fetched (P03/P04's
 * documented `EXTERNAL` provider state) point at a real address that may
 * not always be reachable, and a broken-image icon is never an acceptable
 * "Image unavailable" state (P05 §17). A client component for exactly this
 * reason — reacting to a failed load needs state; nothing else about
 * rendering an image needs to run in the browser.
 */
export function ProductImage({
  src,
  alt,
  className,
  sizes,
  priority,
  noImageLabel = 'لا توجد صورة',
}: ProductImageProps) {
  const [failed, setFailed] = React.useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <div
      className={cn(
        'relative aspect-square w-full overflow-hidden rounded-(--radius-surface) bg-(--color-surface-raised)',
        className,
      )}
    >
      {showImage ? (
        <Image
          src={src!}
          alt={alt}
          fill
          sizes={sizes ?? '(min-width: 1024px) 25vw, 50vw'}
          priority={priority}
          className="object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-(--color-text-muted)">
          <ImageOff className="size-6" aria-hidden="true" />
          <span className="text-caption">{noImageLabel}</span>
        </div>
      )}
    </div>
  );
}
