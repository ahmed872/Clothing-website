'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { ProductImage } from '@/components/commerce/product-image';

export interface ProductGalleryProps {
  images: { src: string; alt: string }[];
  className?: string;
  /** Defaults to Arabic (the store default locale); override per call site for English. */
  thumbnailsLabel?: string;
  noImageLabel?: string;
}

/** Main image + thumbnail strip. Thumbnails are a `radiogroup`: one image is
 * always "selected", arrow keys move between them (native radio behaviour). */
export function ProductGallery({
  images,
  className,
  thumbnailsLabel = 'صور المنتج',
  noImageLabel,
}: ProductGalleryProps) {
  const [active, setActive] = React.useState(0);
  const current = images[active];

  if (!current) {
    return <ProductImage src={null} alt="" className={className} noImageLabel={noImageLabel} />;
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <ProductImage src={current.src} alt={current.alt} priority noImageLabel={noImageLabel} />

      {images.length > 1 ? (
        <div
          role="radiogroup"
          aria-label={thumbnailsLabel}
          className="flex gap-2 overflow-x-auto pb-1"
        >
          {images.map((image, index) => (
            // Index, not `image.src`: a product with no image yet (a real,
            // common state) has every thumbnail at the same empty src, and
            // the list itself never reorders, so index is a stable key here.
            <button
              key={index}
              type="button"
              role="radio"
              aria-checked={index === active}
              aria-label={image.alt}
              onClick={() => setActive(index)}
              className={cn(
                'relative size-16 shrink-0 overflow-hidden rounded-(--radius-sm) ring-2 ring-offset-2 ring-offset-(--color-background) transition-shadow duration-(--duration-fast) outline-none',
                'focus-visible:ring-(--color-ring)',
                index === active
                  ? 'ring-(--color-primary)'
                  : 'ring-transparent hover:ring-(--color-border-strong)',
              )}
            >
              <ProductImage
                src={image.src}
                alt=""
                className="rounded-none"
                sizes="64px"
                noImageLabel={noImageLabel}
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
