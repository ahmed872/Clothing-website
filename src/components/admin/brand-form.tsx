'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Image from 'next/image';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { toast } from '@/components/ui/toast';
import { MediaUploader, type UploadedMediaAsset } from '@/components/admin/media-uploader';
import { createBrandAction, updateBrandAction } from '@/lib/admin/brand-actions';
import { previewSlug } from '@/lib/admin/slugify-preview';
import type { Locale } from '@/lib/i18n/locales';

const brandFormSchema = z.object({
  nameAr: z.string().min(1),
  nameEn: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u),
});
type BrandFormValues = z.infer<typeof brandFormSchema>;

export interface BrandFormLabels {
  nameAr: string;
  nameEn: string;
  slug: string;
  slugHelp: string;
  logo: string;
  chooseFile: string;
  uploading: string;
  uploadError: string;
  save: string;
  saving: string;
  cancel: string;
  requiredField: string;
  createdSuccess: string;
  updatedSuccess: string;
}

export interface BrandFormProps {
  locale: Locale;
  labels: BrandFormLabels;
  brand?: {
    id: string;
    nameAr: string;
    nameEn: string;
    slug: string;
    logoMediaId: string | null;
    logoSrc: string | null;
  };
}

export function BrandForm({ locale, labels, brand }: BrandFormProps) {
  const router = useRouter();
  const [logo, setLogo] = useState<UploadedMediaAsset | null>(
    brand?.logoMediaId
      ? {
          id: brand.logoMediaId,
          src: brand.logoSrc ?? '',
          altAr: null,
          altEn: null,
          width: null,
          height: null,
        }
      : null,
  );
  const [slugTouched, setSlugTouched] = useState(Boolean(brand));
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BrandFormValues>({
    resolver: zodResolver(brandFormSchema),
    defaultValues: {
      nameAr: brand?.nameAr ?? '',
      nameEn: brand?.nameEn ?? '',
      slug: brand?.slug ?? '',
    },
  });

  async function onSubmit(values: BrandFormValues) {
    setFormError(null);
    const payload = { ...values, logoMediaId: logo?.id ?? null };

    const result = brand
      ? await updateBrandAction(brand.id, payload, locale)
      : await createBrandAction(payload, locale);

    if (!result.ok) {
      setFormError(result.error ?? 'Error');
      return;
    }

    toast({
      title: brand ? labels.updatedSuccess : labels.createdSuccess,
      variant: 'success',
    });
    router.push('/admin/brands');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-xl flex-col gap-5">
      {formError ? (
        <Alert variant="error" role="alert">
          {formError}
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="brand-name-en">{labels.nameEn}</Label>
        <Input
          id="brand-name-en"
          {...register('nameEn', {
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
              if (!slugTouched) setValue('slug', previewSlug(event.target.value));
            },
          })}
          aria-invalid={errors.nameEn ? true : undefined}
          aria-describedby={errors.nameEn ? 'brand-name-en-error' : undefined}
        />
        {errors.nameEn ? (
          <p id="brand-name-en-error" className="text-small text-(--color-error)">
            {labels.requiredField}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="brand-name-ar">{labels.nameAr}</Label>
        <Input
          id="brand-name-ar"
          dir="rtl"
          {...register('nameAr')}
          aria-invalid={errors.nameAr ? true : undefined}
          aria-describedby={errors.nameAr ? 'brand-name-ar-error' : undefined}
        />
        {errors.nameAr ? (
          <p id="brand-name-ar-error" className="text-small text-(--color-error)">
            {labels.requiredField}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="brand-slug">{labels.slug}</Label>
        <Input
          id="brand-slug"
          {...register('slug', { onChange: () => setSlugTouched(true) })}
          className="tabular-nums"
          dir="ltr"
          aria-invalid={errors.slug ? true : undefined}
          aria-describedby="brand-slug-help"
        />
        <p id="brand-slug-help" className="text-caption text-(--color-text-muted)">
          {labels.slugHelp}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{labels.logo}</Label>
        {logo?.src ? (
          <div className="flex items-center gap-3">
            <div className="relative size-16 overflow-hidden rounded-(--radius-control) border border-(--color-border) bg-(--color-surface)">
              <Image src={logo.src} alt="" fill sizes="64px" className="object-contain" />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setLogo(null)}
              aria-label="Remove logo"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <MediaUploader
            context="brand"
            onUploaded={setLogo}
            labels={{
              chooseFile: labels.chooseFile,
              uploading: labels.uploading,
              error: labels.uploadError,
            }}
          />
        )}
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
          {isSubmitting ? labels.saving : labels.save}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push('/admin/brands')}>
          {labels.cancel}
        </Button>
      </div>
    </form>
  );
}
