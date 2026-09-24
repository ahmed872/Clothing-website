'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Image from 'next/image';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { toast } from '@/components/ui/toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MediaUploader, type UploadedMediaAsset } from '@/components/admin/media-uploader';
import { createCategoryAction, updateCategoryAction } from '@/lib/admin/category-actions';
import { previewSlug } from '@/lib/admin/slugify-preview';
import type { Locale } from '@/lib/i18n/locales';

const categoryFormSchema = z.object({
  nameAr: z.string().min(1),
  nameEn: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u),
  parentId: z.string().uuid().nullable(),
  position: z.number().int().min(0),
  seoTitleAr: z.string().nullable(),
  seoTitleEn: z.string().nullable(),
  seoDescriptionAr: z.string().nullable(),
  seoDescriptionEn: z.string().nullable(),
});
type CategoryFormValues = z.infer<typeof categoryFormSchema>;

export interface CategoryFormLabels {
  nameAr: string;
  nameEn: string;
  slug: string;
  slugHelp: string;
  parent: string;
  noneOption: string;
  position: string;
  positionHelp: string;
  image: string;
  chooseFile: string;
  uploading: string;
  uploadError: string;
  seoSection: string;
  seoTitleAr: string;
  seoTitleEn: string;
  seoDescriptionAr: string;
  seoDescriptionEn: string;
  save: string;
  saving: string;
  cancel: string;
  requiredField: string;
  createdSuccess: string;
  updatedSuccess: string;
}

export interface CategoryParentOption {
  id: string;
  label: string;
  depth: number;
}

export interface CategoryFormProps {
  locale: Locale;
  labels: CategoryFormLabels;
  parentOptions: CategoryParentOption[];
  category?: {
    id: string;
    nameAr: string;
    nameEn: string;
    slug: string;
    parentId: string | null;
    position: number;
    imageMediaId: string | null;
    imageSrc: string | null;
    seoTitleAr: string | null;
    seoTitleEn: string | null;
    seoDescriptionAr: string | null;
    seoDescriptionEn: string | null;
  };
}

export function CategoryForm({ locale, labels, parentOptions, category }: CategoryFormProps) {
  const router = useRouter();
  const [image, setImage] = useState<UploadedMediaAsset | null>(
    category?.imageMediaId
      ? {
          id: category.imageMediaId,
          src: category.imageSrc ?? '',
          altAr: null,
          altEn: null,
          width: null,
          height: null,
        }
      : null,
  );
  const [slugTouched, setSlugTouched] = useState(Boolean(category));
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      nameAr: category?.nameAr ?? '',
      nameEn: category?.nameEn ?? '',
      slug: category?.slug ?? '',
      parentId: category?.parentId ?? null,
      position: category?.position ?? 0,
      seoTitleAr: category?.seoTitleAr ?? null,
      seoTitleEn: category?.seoTitleEn ?? null,
      seoDescriptionAr: category?.seoDescriptionAr ?? null,
      seoDescriptionEn: category?.seoDescriptionEn ?? null,
    },
  });

  async function onSubmit(values: CategoryFormValues) {
    setFormError(null);
    const payload = {
      ...values,
      seoTitleAr: values.seoTitleAr || null,
      seoTitleEn: values.seoTitleEn || null,
      seoDescriptionAr: values.seoDescriptionAr || null,
      seoDescriptionEn: values.seoDescriptionEn || null,
      imageMediaId: image?.id ?? null,
    };

    const result = category
      ? await updateCategoryAction(category.id, payload, locale)
      : await createCategoryAction(payload, locale);

    if (!result.ok) {
      setFormError(result.error ?? 'Error');
      return;
    }

    toast({
      title: category ? labels.updatedSuccess : labels.createdSuccess,
      variant: 'success',
    });
    router.push('/admin/categories');
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
        <Label htmlFor="category-name-en">{labels.nameEn}</Label>
        <Input
          id="category-name-en"
          {...register('nameEn', {
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
              if (!slugTouched) setValue('slug', previewSlug(event.target.value));
            },
          })}
          aria-invalid={errors.nameEn ? true : undefined}
          aria-describedby={errors.nameEn ? 'category-name-en-error' : undefined}
        />
        {errors.nameEn ? (
          <p id="category-name-en-error" className="text-small text-(--color-error)">
            {labels.requiredField}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="category-name-ar">{labels.nameAr}</Label>
        <Input
          id="category-name-ar"
          dir="rtl"
          {...register('nameAr')}
          aria-invalid={errors.nameAr ? true : undefined}
          aria-describedby={errors.nameAr ? 'category-name-ar-error' : undefined}
        />
        {errors.nameAr ? (
          <p id="category-name-ar-error" className="text-small text-(--color-error)">
            {labels.requiredField}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="category-slug">{labels.slug}</Label>
        <Input
          id="category-slug"
          {...register('slug', { onChange: () => setSlugTouched(true) })}
          className="tabular-nums"
          dir="ltr"
          aria-invalid={errors.slug ? true : undefined}
          aria-describedby="category-slug-help"
        />
        <p id="category-slug-help" className="text-caption text-(--color-text-muted)">
          {labels.slugHelp}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="category-parent">{labels.parent}</Label>
        <Controller
          control={control}
          name="parentId"
          render={({ field }) => (
            <Select
              value={field.value ?? '__none__'}
              onValueChange={(value) => field.onChange(value === '__none__' ? null : value)}
            >
              <SelectTrigger id="category-parent">
                <SelectValue>
                  {field.value
                    ? (parentOptions.find((o) => o.id === field.value)?.label ?? labels.noneOption)
                    : labels.noneOption}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{labels.noneOption}</SelectItem>
                {parentOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {'—'.repeat(option.depth)} {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="category-position">{labels.position}</Label>
        <Input
          id="category-position"
          type="number"
          min={0}
          className="max-w-32 tabular-nums"
          {...register('position', { valueAsNumber: true })}
        />
        <p className="text-caption text-(--color-text-muted)">{labels.positionHelp}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{labels.image}</Label>
        {image?.src ? (
          <div className="flex items-center gap-3">
            <div className="relative size-16 overflow-hidden rounded-(--radius-control) border border-(--color-border) bg-(--color-surface)">
              <Image src={image.src} alt="" fill sizes="64px" className="object-contain" />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setImage(null)}
              aria-label="Remove image"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <MediaUploader
            context="category"
            onUploaded={setImage}
            labels={{
              chooseFile: labels.chooseFile,
              uploading: labels.uploading,
              error: labels.uploadError,
            }}
          />
        )}
      </div>

      <fieldset className="flex flex-col gap-4 rounded-(--radius-panel) border border-(--color-border) p-4">
        <legend className="px-1 text-small font-medium text-(--color-text)">
          {labels.seoSection}
        </legend>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="category-seo-title-en">{labels.seoTitleEn}</Label>
          <Input id="category-seo-title-en" {...register('seoTitleEn')} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="category-seo-title-ar">{labels.seoTitleAr}</Label>
          <Input id="category-seo-title-ar" dir="rtl" {...register('seoTitleAr')} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="category-seo-description-en">{labels.seoDescriptionEn}</Label>
          <Textarea id="category-seo-description-en" {...register('seoDescriptionEn')} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="category-seo-description-ar">{labels.seoDescriptionAr}</Label>
          <Textarea id="category-seo-description-ar" dir="rtl" {...register('seoDescriptionAr')} />
        </div>
      </fieldset>

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
          {isSubmitting ? labels.saving : labels.save}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push('/admin/categories')}>
          {labels.cancel}
        </Button>
      </div>
    </form>
  );
}
