'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Star, Trash2, ChevronUp, ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { toast } from '@/components/ui/toast';
import { MediaUploader } from '@/components/admin/media-uploader';
import {
  attachProductImageAction,
  detachProductImageAction,
  setPrimaryProductImageAction,
  reorderProductImagesAction,
} from '@/lib/admin/product-image-actions';
import type { Locale } from '@/lib/i18n/locales';

export interface ProductImageRow {
  id: string;
  mediaId: string;
  src: string;
  alt: string;
  isPrimary: boolean;
}

export interface ProductImagesManagerLabels {
  chooseFile: string;
  uploading: string;
  uploadError: string;
  primaryImage: string;
  setPrimary: string;
  removeImage: string;
  moveUp: string;
  moveDown: string;
  imagesEmpty: string;
  savedSuccessfully: string;
  deletedSuccessfully: string;
}

/**
 * Ordering is arrow buttons, not drag and drop: P07 §12 asks for no heavy
 * dependency without a reason, and a drag target is the one interaction
 * that is genuinely worse on a phone. Each move is a single `reorder` call
 * with the full new order, which is what the domain service validates
 * against (all-or-nothing, exactly the product's current images).
 */
export function ProductImagesManager({
  productId,
  locale,
  images,
  labels,
}: {
  productId: string;
  locale: Locale;
  images: ProductImageRow[];
  labels: ProductImagesManagerLabels;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>, successText: string) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? null);
      return;
    }
    toast({ title: successText, variant: 'success' });
    router.refresh();
  }

  function move(index: number, direction: -1 | 1): void {
    const next = [...images];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    void run(
      () =>
        reorderProductImagesAction(
          productId,
          next.map((image) => image.id),
          locale,
        ),
      labels.savedSuccessfully,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="error" role="alert">
          {error}
        </Alert>
      ) : null}

      {images.length === 0 ? (
        <p className="text-small text-(--color-text-muted)">{labels.imagesEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {images.map((image, index) => (
            <li
              key={image.id}
              className="flex flex-wrap items-center gap-3 rounded-(--radius-panel) border border-(--color-border) bg-(--color-surface) p-3"
            >
              <div className="relative size-16 shrink-0 overflow-hidden rounded-(--radius-control) border border-(--color-border)">
                <Image src={image.src} alt={image.alt} fill sizes="64px" className="object-cover" />
              </div>

              {image.isPrimary ? <Badge variant="brand">{labels.primaryImage}</Badge> : null}

              <div className="ms-auto flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={busy || index === 0}
                  aria-label={labels.moveUp}
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={busy || index === images.length - 1}
                  aria-label={labels.moveDown}
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={busy || image.isPrimary}
                  aria-label={labels.setPrimary}
                  onClick={() =>
                    void run(
                      () => setPrimaryProductImageAction(image.id, productId, locale),
                      labels.savedSuccessfully,
                    )
                  }
                >
                  <Star className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={busy}
                  aria-label={labels.removeImage}
                  onClick={() =>
                    void run(
                      () => detachProductImageAction(image.id, productId, locale),
                      labels.deletedSuccessfully,
                    )
                  }
                >
                  <Trash2 className="size-4 text-(--color-error)" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <MediaUploader
        context="product"
        multiple
        onUploaded={(asset) =>
          void run(
            () => attachProductImageAction(productId, asset.id, locale),
            labels.savedSuccessfully,
          )
        }
        labels={{
          chooseFile: labels.chooseFile,
          uploading: labels.uploading,
          error: labels.uploadError,
        }}
      />
    </div>
  );
}
