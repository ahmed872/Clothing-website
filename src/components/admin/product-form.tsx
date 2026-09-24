'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormSection } from '@/components/admin/form-section';
import { AttributeFields, type AttributeValues } from '@/components/admin/attribute-fields';
import {
  createProductAction,
  updateProductAction,
  attributeFieldsForCategoryAction,
  type AttributeFieldDefinition,
} from '@/lib/admin/product-actions';
import { previewSlug } from '@/lib/admin/slugify-preview';
import { toMinor } from '@/modules/core/money';
import type { Locale } from '@/lib/i18n/locales';

const productFormSchema = z.object({
  nameAr: z.string().min(1),
  nameEn: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u),
  descriptionAr: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  categoryId: z.string().uuid(),
  brandId: z.string().uuid().nullable(),
  featured: z.boolean(),
  seoTitleAr: z.string().nullable(),
  seoTitleEn: z.string().nullable(),
  seoDescriptionAr: z.string().nullable(),
  seoDescriptionEn: z.string().nullable(),
  /** Create only — an existing product's pricing and stock live in its
   * variants, edited from the Inventory and Pricing screens. */
  sku: z.string().optional(),
  price: z.string().optional(),
  stockQuantity: z.string().optional(),
});
type ProductFormValues = z.infer<typeof productFormSchema>;

export interface ProductOption {
  value: string;
  label: string;
}

export interface ProductFormLabels {
  sectionBasic: string;
  sectionBasicDescription: string;
  sectionAttributes: string;
  sectionAttributesDescription: string;
  sectionPricing: string;
  sectionPricingDescription: string;
  sectionSeo: string;
  sectionSeoDescription: string;
  nameAr: string;
  nameEn: string;
  slug: string;
  slugHelp: string;
  descriptionAr: string;
  descriptionEn: string;
  category: string;
  brand: string;
  noneOption: string;
  featured: string;
  sku: string;
  skuHelp: string;
  price: string;
  priceHelp: string;
  stockQuantity: string;
  stockQuantityHelp: string;
  attributesEmpty: string;
  selectCategoryFirst: string;
  seoTitleAr: string;
  seoTitleEn: string;
  seoDescriptionAr: string;
  seoDescriptionEn: string;
  save: string;
  saveDraft: string;
  saving: string;
  cancel: string;
  requiredField: string;
  createdSuccess: string;
  updatedSuccess: string;
}

export interface ProductFormProps {
  locale: Locale;
  labels: ProductFormLabels;
  categoryOptions: ProductOption[];
  brandOptions: ProductOption[];
  product?: {
    id: string;
    nameAr: string;
    nameEn: string;
    slug: string;
    descriptionAr: string | null;
    descriptionEn: string | null;
    categoryId: string;
    brandId: string | null;
    featured: boolean;
    attributes: AttributeValues;
    seoTitleAr: string | null;
    seoTitleEn: string | null;
    seoDescriptionAr: string | null;
    seoDescriptionEn: string | null;
    /** ISO — handed straight back on save as the optimistic-concurrency
     * check, so a second admin's save in between is refused rather than
     * silently overwritten. */
    updatedAt: string;
  };
  /** The chosen category's attribute schema, resolved server-side for the
   * first render; re-fetched client-side whenever the category changes. */
  initialAttributeDefinitions: AttributeFieldDefinition[];
}

export function ProductForm({
  locale,
  labels,
  categoryOptions,
  brandOptions,
  product,
  initialAttributeDefinitions,
}: ProductFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(Boolean(product));
  const [attributeDefinitions, setAttributeDefinitions] = useState(initialAttributeDefinitions);
  const [attributes, setAttributes] = useState<AttributeValues>(product?.attributes ?? {});
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(product?.updatedAt ?? null);
  const [loadingAttributes, startLoadingAttributes] = useTransition();

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      nameAr: product?.nameAr ?? '',
      nameEn: product?.nameEn ?? '',
      slug: product?.slug ?? '',
      descriptionAr: product?.descriptionAr ?? null,
      descriptionEn: product?.descriptionEn ?? null,
      categoryId: product?.categoryId ?? categoryOptions[0]?.value ?? '',
      brandId: product?.brandId ?? null,
      featured: product?.featured ?? false,
      seoTitleAr: product?.seoTitleAr ?? null,
      seoTitleEn: product?.seoTitleEn ?? null,
      seoDescriptionAr: product?.seoDescriptionAr ?? null,
      seoDescriptionEn: product?.seoDescriptionEn ?? null,
      sku: '',
      price: '',
      stockQuantity: '',
    },
  });

  /** Switching category switches the whole attribute schema — the fields
   * come from the new category, and values keyed to the old category's
   * definitions no longer mean anything (the server rejects them outright:
   * `validateProductAttributes` is `.strict()`). */
  function onCategoryChange(categoryId: string): void {
    setValue('categoryId', categoryId);
    setAttributes({});
    startLoadingAttributes(async () => {
      const result = await attributeFieldsForCategoryAction(categoryId);
      setAttributeDefinitions(result.data ?? []);
    });
  }

  async function onSubmit(values: ProductFormValues): Promise<void> {
    setFormError(null);

    const core = {
      nameAr: values.nameAr,
      nameEn: values.nameEn,
      slug: values.slug,
      descriptionAr: values.descriptionAr || null,
      descriptionEn: values.descriptionEn || null,
      categoryId: values.categoryId,
      brandId: values.brandId,
      featured: values.featured,
      attributes,
      seoTitleAr: values.seoTitleAr || null,
      seoTitleEn: values.seoTitleEn || null,
      seoDescriptionAr: values.seoDescriptionAr || null,
      seoDescriptionEn: values.seoDescriptionEn || null,
    };

    if (product) {
      const result = await updateProductAction(product.id, core, expectedUpdatedAt, locale);
      if (!result.ok) {
        setFormError(result.error ?? 'Error');
        return;
      }
      // Keep the concurrency token current so a second save from this same
      // open form isn't rejected as stale against its own first save.
      setExpectedUpdatedAt(result.data?.updatedAt ?? null);
      toast({ title: labels.updatedSuccess, variant: 'success' });
      router.refresh();
      return;
    }

    const priceMajor = Number(values.price);
    const result = await createProductAction(
      {
        product: core,
        initialVariant: {
          sku: values.sku ?? '',
          priceMinor: Number.isFinite(priceMajor) ? toMinor(priceMajor) : 0,
          // Blank means none in stock, which is what the column defaults to
          // anyway — but it is now a stated choice rather than a surprise.
          stockQuantity: Math.max(0, Math.trunc(Number(values.stockQuantity)) || 0),
        },
      },
      locale,
    );
    if (!result.ok) {
      setFormError(result.error ?? 'Error');
      return;
    }
    toast({ title: labels.createdSuccess, variant: 'success' });
    // Straight to the edit page: images, options and variants all need a
    // product id to attach to, and publishing is a decision made after them.
    router.push(`/admin/products/${result.data?.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col">
      {formError ? (
        <Alert variant="error" role="alert" className="mb-4">
          {formError}
        </Alert>
      ) : null}

      <FormSection title={labels.sectionBasic} description={labels.sectionBasicDescription}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-name-en">{labels.nameEn}</Label>
          <Input
            id="product-name-en"
            {...register('nameEn', {
              onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                if (!slugTouched) setValue('slug', previewSlug(event.target.value));
              },
            })}
            aria-invalid={errors.nameEn ? true : undefined}
            aria-describedby={errors.nameEn ? 'product-name-en-error' : undefined}
          />
          {errors.nameEn ? (
            <p id="product-name-en-error" className="text-small text-(--color-error)">
              {labels.requiredField}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-name-ar">{labels.nameAr}</Label>
          <Input
            id="product-name-ar"
            dir="rtl"
            {...register('nameAr')}
            aria-invalid={errors.nameAr ? true : undefined}
            aria-describedby={errors.nameAr ? 'product-name-ar-error' : undefined}
          />
          {errors.nameAr ? (
            <p id="product-name-ar-error" className="text-small text-(--color-error)">
              {labels.requiredField}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-slug">{labels.slug}</Label>
          <Input
            id="product-slug"
            dir="ltr"
            className="tabular-nums"
            {...register('slug', { onChange: () => setSlugTouched(true) })}
            aria-invalid={errors.slug ? true : undefined}
            aria-describedby="product-slug-help"
          />
          <p id="product-slug-help" className="text-caption text-(--color-text-muted)">
            {labels.slugHelp}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-description-en">{labels.descriptionEn}</Label>
          <Textarea id="product-description-en" {...register('descriptionEn')} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-description-ar">{labels.descriptionAr}</Label>
          <Textarea id="product-description-ar" dir="rtl" {...register('descriptionAr')} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-category">{labels.category}</Label>
          <Controller
            control={control}
            name="categoryId"
            render={({ field }) => (
              <Select value={field.value} onValueChange={onCategoryChange}>
                <SelectTrigger id="product-category">
                  <SelectValue>
                    {categoryOptions.find((o) => o.value === field.value)?.label ??
                      labels.noneOption}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-brand">{labels.brand}</Label>
          <Controller
            control={control}
            name="brandId"
            render={({ field }) => (
              <Select
                value={field.value ?? '__none__'}
                onValueChange={(value) => field.onChange(value === '__none__' ? null : value)}
              >
                <SelectTrigger id="product-brand">
                  <SelectValue>
                    {field.value
                      ? (brandOptions.find((o) => o.value === field.value)?.label ??
                        labels.noneOption)
                      : labels.noneOption}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{labels.noneOption}</SelectItem>
                  {brandOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-(--radius-control) border border-(--color-border) p-3">
          <Label htmlFor="product-featured" className="cursor-pointer">
            {labels.featured}
          </Label>
          <Controller
            control={control}
            name="featured"
            render={({ field }) => (
              <Switch
                id="product-featured"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </div>
      </FormSection>

      <FormSection
        title={labels.sectionAttributes}
        description={labels.sectionAttributesDescription}
        className="border-t border-(--color-border)"
      >
        {loadingAttributes ? (
          <p className="text-small text-(--color-text-muted)">…</p>
        ) : (
          <AttributeFields
            definitions={attributeDefinitions}
            values={attributes}
            onChange={setAttributes}
            locale={locale}
            labels={{
              noneOption: labels.noneOption,
              emptyDescription: labels.attributesEmpty,
            }}
          />
        )}
      </FormSection>

      {product ? null : (
        <FormSection
          title={labels.sectionPricing}
          description={labels.sectionPricingDescription}
          className="border-t border-(--color-border)"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-sku">{labels.sku}</Label>
            <Input id="product-sku" dir="ltr" className="tabular-nums" {...register('sku')} />
            <p className="text-caption text-(--color-text-muted)">{labels.skuHelp}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-price">{labels.price}</Label>
            <Input
              id="product-price"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              className="max-w-40 tabular-nums"
              {...register('price')}
            />
            <p className="text-caption text-(--color-text-muted)">{labels.priceHelp}</p>
          </div>
          {/* Without this field every new product was created with zero
              stock and therefore shown as out of stock, and the only way to
              fix it was a different screen the owner had no reason to know
              about. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-stock">{labels.stockQuantity}</Label>
            <Input
              id="product-stock"
              type="number"
              min={0}
              step="1"
              inputMode="numeric"
              className="max-w-40 tabular-nums"
              {...register('stockQuantity')}
            />
            <p className="text-caption text-(--color-text-muted)">{labels.stockQuantityHelp}</p>
          </div>
        </FormSection>
      )}

      <FormSection
        title={labels.sectionSeo}
        description={labels.sectionSeoDescription}
        className="border-t border-(--color-border)"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-seo-title-en">{labels.seoTitleEn}</Label>
          <Input id="product-seo-title-en" {...register('seoTitleEn')} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-seo-title-ar">{labels.seoTitleAr}</Label>
          <Input id="product-seo-title-ar" dir="rtl" {...register('seoTitleAr')} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-seo-description-en">{labels.seoDescriptionEn}</Label>
          <Textarea id="product-seo-description-en" {...register('seoDescriptionEn')} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-seo-description-ar">{labels.seoDescriptionAr}</Label>
          <Textarea id="product-seo-description-ar" dir="rtl" {...register('seoDescriptionAr')} />
        </div>
      </FormSection>

      <div className="flex items-center gap-2 border-t border-(--color-border) pt-5">
        <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
          {isSubmitting ? labels.saving : product ? labels.save : labels.saveDraft}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push('/admin/products')}>
          {labels.cancel}
        </Button>
      </div>
    </form>
  );
}
