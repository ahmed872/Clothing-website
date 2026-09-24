'use client';

import * as React from 'react';
import Image, { type ImageProps } from 'next/image';

import { cn } from '@/lib/utils';

/**
 * `next/image`, but a failed load (an unreachable `EXTERNAL` MediaAsset —
 * see `ProductImage`'s docstring for the same case) collapses to a plain
 * token-coloured surface instead of a broken-image icon. For non-square
 * marketing imagery (hero/banner sections) where `ProductImage`'s fixed
 * 1:1 frame doesn't fit — same "Image unavailable" rule (P05 §17), applied
 * to whatever aspect ratio the caller's wrapping element gives it.
 */
export function SafeImage({ className, onError, ...props }: ImageProps) {
  const [failed, setFailed] = React.useState(false);
  if (failed)
    return <div className={cn('bg-(--color-surface-raised)', className)} aria-hidden="true" />;

  return (
    // `alt` is already required by `ImageProps` (next/image's own type) and
    // arrives through the spread — the a11y rule can't see that statically.
    // eslint-disable-next-line jsx-a11y/alt-text
    <Image
      {...props}
      className={className}
      onError={(event) => {
        setFailed(true);
        onError?.(event);
      }}
    />
  );
}
