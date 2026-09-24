'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import Image from 'next/image';
import { Plus, X } from 'lucide-react';
import type { HomepageSectionType } from '@generated/prisma';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { FormSection } from '@/components/admin/form-section';
import { MediaUploader } from '@/components/admin/media-uploader';
import { ContentCategoryPicker, ContentProductPicker } from '@/components/admin/content-pickers';
import {
  createHomepageSectionAction,
  updateHomepageSectionAction,
  type ContentPickerOption,
} from '@/lib/admin/content-actions';
import type { Locale } from '@/lib/i18n/locales';

/**
 * One form for all ten section types (P15).
 *
 * The ten `HomepageSectionType`s do not share a shape, but they do share
 * almost all of their *fields* — a bilingual title, a call to action, an
 * image, a tone, a list of products. So rather than ten forms (ten places to
 * forget a translation) or one raw-JSON textarea (which would make the
 * screen useless to the person it exists for), this holds every field once
 * and `TYPE_FIELDS` decides which of them a given type renders.
 *
 * `buildConfig` is the one place the flat form state becomes the shape
 * `section-schemas.ts` validates. It omits empty optional strings rather
 * than storing `""`, so a config carries only what was actually filled in;
 * the server re-validates the result either way and is the authority.
 */

export interface TestimonialDraft {
  authorName: string;
  authorTitleAr: string;
  authorTitleEn: string;
  quoteAr: string;
  quoteEn: string;
  rating: string;
}

export interface TrustBlockDraft {
  icon: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
}

export interface SectionFormValues {
  titleAr: string;
  titleEn: string;
  subtitleAr: string;
  subtitleEn: string;
  bodyAr: string;
  bodyEn: string;
  ctaLabelAr: string;
  ctaLabelEn: string;
  ctaHref: string;
  tone: 'brand' | 'accent' | 'neutral';
  limit: string;
  categoryId: string;
  image: { id: string; src: string } | null;
  products: ContentPickerOption[];
  categories: ContentPickerOption[];
  testimonials: TestimonialDraft[];
  trustBlocks: TrustBlockDraft[];
}

export const EMPTY_SECTION_VALUES: SectionFormValues = {
  titleAr: '',
  titleEn: '',
  subtitleAr: '',
  subtitleEn: '',
  bodyAr: '',
  bodyEn: '',
  ctaLabelAr: '',
  ctaLabelEn: '',
  ctaHref: '',
  tone: 'brand',
  limit: '8',
  categoryId: '',
  image: null,
  products: [],
  categories: [],
  testimonials: [],
  trustBlocks: [],
};

interface TypeFieldSet {
  /** Whether `titleAr`/`titleEn` are required by this type's schema. */
  titles: 'required' | 'optional';
  subtitle?: true;
  body?: true;
  cta?: true;
  image?: true;
  tone?: true;
  products?: true;
  categories?: true;
  categorySingle?: true;
  limit?: true;
  testimonials?: true;
  trustBlocks?: true;
}

/** Mirrors `section-schemas.ts` exactly — the two must agree, and the server
 * is what enforces it: a mismatch here shows up as a save the server
 * rejects, never as an invalid row. */
const TYPE_FIELDS: Record<HomepageSectionType, TypeFieldSet> = {
  HERO: { titles: 'required', subtitle: true, cta: true, image: true },
  BANNER: { titles: 'required', subtitle: true, cta: true, image: true, tone: true },
  CUSTOM_PROMO: { titles: 'required', body: true, cta: true, image: true, tone: true },
  FEATURED_CATEGORIES: { titles: 'optional', categories: true },
  FEATURED_PRODUCTS: { titles: 'optional', products: true },
  BEST_SELLERS: { titles: 'optional', products: true },
  ACTIVE_OFFERS: { titles: 'optional', products: true },
  NEW_ARRIVALS: { titles: 'optional', categorySingle: true, limit: true },
  TESTIMONIALS: { titles: 'optional', testimonials: true },
  TRUST_BLOCKS: { titles: 'optional', trustBlocks: true },
};

export const TRUST_BLOCK_ICON_NAMES = [
  'ShieldCheck',
  'Truck',
  'RotateCcw',
  'CreditCard',
  'Headphones',
  'BadgeCheck',
  'Lock',
  'Clock',
] as const;

export type SectionFormLabels = {
  types: Record<string, string>;
  typeHelp: Record<string, string>;
  icons: Record<string, string>;
} & Record<string, string | Record<string, string>>;

function text(labels: SectionFormLabels, key: string): string {
  const value = labels[key];
  return typeof value === 'string' ? value : key;
}

/** `undefined` for a blank optional field, so the stored config carries only
 * what was filled in rather than a spread of empty strings. */
function trimmed(value: string): string | undefined {
  const cleaned = value.trim();
  return cleaned === '' ? undefined : cleaned;
}

export function buildConfig(
  type: HomepageSectionType,
  values: SectionFormValues,
): Record<string, unknown> {
  const fields = TYPE_FIELDS[type];
  const config: Record<string, unknown> = {};

  if (fields.titles === 'required') {
    config.titleAr = values.titleAr.trim();
    config.titleEn = values.titleEn.trim();
  } else {
    config.titleAr = trimmed(values.titleAr);
    config.titleEn = trimmed(values.titleEn);
  }

  if (fields.subtitle) {
    config.subtitleAr = trimmed(values.subtitleAr);
    config.subtitleEn = trimmed(values.subtitleEn);
  }
  if (fields.body) {
    config.bodyAr = trimmed(values.bodyAr);
    config.bodyEn = trimmed(values.bodyEn);
  }
  if (fields.cta) {
    config.ctaLabelAr = trimmed(values.ctaLabelAr);
    config.ctaLabelEn = trimmed(values.ctaLabelEn);
    config.ctaHref = trimmed(values.ctaHref);
  }
  if (fields.image) config.imageMediaId = values.image?.id;
  if (fields.tone) config.tone = values.tone;
  if (fields.limit) config.limit = Number(values.limit);
  if (fields.categorySingle) config.categoryId = values.categoryId || undefined;
  if (fields.categories) config.categoryIds = values.categories.map((item) => item.id);
  if (fields.products) config.productIds = values.products.map((item) => item.id);

  if (fields.testimonials) {
    config.items = values.testimonials.map((item) => ({
      authorName: item.authorName.trim(),
      authorTitleAr: trimmed(item.authorTitleAr),
      authorTitleEn: trimmed(item.authorTitleEn),
      quoteAr: item.quoteAr.trim(),
      quoteEn: item.quoteEn.trim(),
      rating: item.rating === '' ? undefined : Number(item.rating),
    }));
  }
  if (fields.trustBlocks) {
    config.items = values.trustBlocks.map((item) => ({
      icon: item.icon,
      titleAr: item.titleAr.trim(),
      titleEn: item.titleEn.trim(),
      descriptionAr: trimmed(item.descriptionAr),
      descriptionEn: trimmed(item.descriptionEn),
    }));
  }

  return config;
}

const INTERNAL_OR_ABSOLUTE_HREF = /^(\/[^\s]*|https?:\/\/\S+)$/;

/**
 * The checks worth making before a round trip. Deliberately not a second
 * copy of the Zod schemas — the server parses the real thing and its
 * rejection is shown inline. These are the ones that would otherwise cost
 * the person a submit to discover.
 */
export function validateValues(
  type: HomepageSectionType,
  values: SectionFormValues,
  labels: SectionFormLabels,
): Record<string, string> {
  const fields = TYPE_FIELDS[type];
  const errors: Record<string, string> = {};

  if (fields.titles === 'required') {
    if (values.titleAr.trim() === '') errors.titleAr = text(labels, 'requiredField');
    if (values.titleEn.trim() === '') errors.titleEn = text(labels, 'requiredField');
  }
  if (fields.cta && values.ctaHref.trim() !== '') {
    if (!INTERNAL_OR_ABSOLUTE_HREF.test(values.ctaHref.trim())) {
      errors.ctaHref = text(labels, 'ctaHrefInvalid');
    }
  }
  if (fields.products && values.products.length === 0) {
    errors.products = text(labels, 'requireOneProduct');
  }
  if (fields.categories && values.categories.length === 0) {
    errors.categories = text(labels, 'requireOneCategory');
  }
  if (fields.testimonials) {
    if (values.testimonials.length === 0) errors.items = text(labels, 'requireOneItem');
    else if (
      values.testimonials.some(
        (item) =>
          item.authorName.trim() === '' || item.quoteAr.trim() === '' || item.quoteEn.trim() === '',
      )
    ) {
      errors.items = text(labels, 'requiredField');
    }
  }
  if (fields.trustBlocks) {
    if (values.trustBlocks.length === 0) errors.items = text(labels, 'requireOneItem');
    else if (
      values.trustBlocks.some((item) => item.titleAr.trim() === '' || item.titleEn.trim() === '')
    ) {
      errors.items = text(labels, 'requiredField');
    }
  }
  if (fields.limit) {
    const limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 24) {
      errors.limit = text(labels, 'limitHelp');
    }
  }

  return errors;
}

export function HomepageSectionForm({
  mode,
  type,
  sectionId,
  locale,
  initialValues,
  initialEnabled,
  categories,
  labels,
  hasDraft,
}: {
  mode: 'create' | 'edit';
  type: HomepageSectionType;
  sectionId?: string;
  locale: Locale;
  initialValues: SectionFormValues;
  initialEnabled: boolean;
  categories: ContentPickerOption[];
  labels: SectionFormLabels;
  /** Whether the row already carries an unpublished draft. Only changes the
   * wording of what "save as draft" replaces; the server decides the rest. */
  hasDraft: boolean;
}) {
  const router = useRouter();
  const fieldId = useId();
  const [values, setValues] = useState<SectionFormValues>(initialValues);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'publish' | 'draft' | null>(null);

  const fields = TYPE_FIELDS[type];

  function set<K extends keyof SectionFormValues>(key: K, value: SectionFormValues[K]): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(intent: 'publish' | 'draft'): Promise<void> {
    const found = validateValues(type, values, labels);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(intent);
    setFormError(null);
    const config = buildConfig(type, values);

    const result =
      mode === 'create'
        ? await createHomepageSectionAction({ type, config, enabled }, locale)
        : await updateHomepageSectionAction(sectionId!, config, intent, locale);

    setSaving(null);
    if (!result.ok) {
      setFormError(result.error ?? text(labels, 'errorGeneric'));
      return;
    }

    toast({
      title:
        mode === 'create'
          ? text(labels, 'created')
          : intent === 'publish'
            ? text(labels, 'published')
            : text(labels, 'draftSaved'),
      variant: 'success',
    });
    router.push('/admin/content');
    router.refresh();
  }

  function textField(
    key: keyof SectionFormValues,
    label: string,
    options: { dir?: 'ltr' | 'rtl'; help?: string; multiline?: boolean; optional?: boolean } = {},
  ) {
    const id = `${fieldId}-${key}`;
    const error = errors[key];
    const Control = options.multiline ? Textarea : Input;
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>
          {label}
          {options.optional ? (
            <span className="ms-1 text-(--color-text-subtle)">
              ({text(labels, 'optionalHint')})
            </span>
          ) : null}
        </Label>
        <Control
          id={id}
          dir={options.dir}
          value={String(values[key] ?? '')}
          onChange={(event: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) =>
            set(key, event.target.value as SectionFormValues[typeof key])
          }
          aria-invalid={error ? true : undefined}
          aria-describedby={options.help || error ? `${id}-help` : undefined}
        />
        {options.help || error ? (
          <p
            id={`${id}-help`}
            className={
              error ? 'text-small text-(--color-error)' : 'text-caption text-(--color-text-muted)'
            }
          >
            {error ?? options.help}
          </p>
        ) : null}
      </div>
    );
  }

  const pickerLabels = {
    searchPlaceholder: text(labels, 'productSearchPlaceholder'),
    searchButton: text(labels, 'searchButton'),
    searching: text(labels, 'searching'),
    noResults: text(labels, 'noResults'),
    searchHint: text(labels, 'searchHint'),
    add: text(labels, 'addItem'),
    remove: text(labels, 'removeItem'),
    selected: text(labels, 'selectedItems'),
    moveUp: text(labels, 'moveItemUp'),
    moveDown: text(labels, 'moveItemDown'),
    notPublished: text(labels, 'notPublishedBadge'),
    notPublishedHelp: text(labels, 'notPublishedHelp'),
    categoryLabel: text(labels, 'fieldCategories'),
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit('publish');
      }}
      className="flex flex-col divide-y divide-(--color-border)"
    >
      {formError ? (
        <Alert variant="error" role="alert" className="mb-6">
          {formError}
        </Alert>
      ) : null}

      {mode === 'edit' && hasDraft ? (
        <Alert variant="warning" className="mb-6">
          {text(labels, 'draftNotice')}
        </Alert>
      ) : null}

      <FormSection
        title={text(labels, 'contentStepTitle')}
        description={`${text(labels, 'contentStepDescription')} — ${labels.typeHelp[type] ?? ''}`}
      >
        {textField('titleAr', text(labels, 'fieldTitleAr'), {
          dir: 'rtl',
          optional: fields.titles === 'optional',
        })}
        {textField('titleEn', text(labels, 'fieldTitleEn'), {
          dir: 'ltr',
          optional: fields.titles === 'optional',
        })}

        {fields.subtitle ? (
          <>
            {textField('subtitleAr', text(labels, 'fieldSubtitleAr'), {
              dir: 'rtl',
              optional: true,
            })}
            {textField('subtitleEn', text(labels, 'fieldSubtitleEn'), {
              dir: 'ltr',
              optional: true,
            })}
          </>
        ) : null}

        {fields.body ? (
          <>
            {textField('bodyAr', text(labels, 'fieldBodyAr'), {
              dir: 'rtl',
              multiline: true,
              optional: true,
            })}
            {textField('bodyEn', text(labels, 'fieldBodyEn'), {
              dir: 'ltr',
              multiline: true,
              optional: true,
            })}
          </>
        ) : null}
      </FormSection>

      {fields.cta ? (
        <FormSection title={text(labels, 'ctaSectionTitle')}>
          {textField('ctaLabelAr', text(labels, 'fieldCtaLabelAr'), {
            dir: 'rtl',
            optional: true,
          })}
          {textField('ctaLabelEn', text(labels, 'fieldCtaLabelEn'), {
            dir: 'ltr',
            optional: true,
          })}
          {textField('ctaHref', text(labels, 'fieldCtaHref'), {
            dir: 'ltr',
            optional: true,
            help: text(labels, 'ctaHrefHelp'),
          })}
        </FormSection>
      ) : null}

      {fields.image || fields.tone ? (
        <FormSection title={text(labels, 'mediaSectionTitle')}>
          {fields.image ? (
            <div className="flex flex-col gap-1.5">
              <Label>{text(labels, 'fieldImage')}</Label>
              {values.image ? (
                <div className="flex items-center gap-3">
                  <div className="relative h-20 w-32 overflow-hidden rounded-(--radius-control) border border-(--color-border) bg-(--color-surface)">
                    <Image
                      src={values.image.src}
                      alt=""
                      fill
                      sizes="128px"
                      className="object-cover"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={text(labels, 'removeImage')}
                    onClick={() => set('image', null)}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : (
                <MediaUploader
                  context="homepage"
                  onUploaded={(asset) => set('image', { id: asset.id, src: asset.src })}
                  labels={{
                    chooseFile: text(labels, 'chooseFile'),
                    uploading: text(labels, 'uploading'),
                    error: text(labels, 'uploadError'),
                  }}
                />
              )}
            </div>
          ) : null}

          {fields.tone ? (
            <div className="flex flex-col gap-1.5">
              <Label id={`${fieldId}-tone-label`}>{text(labels, 'fieldTone')}</Label>
              <Select
                value={values.tone}
                onValueChange={(next) => set('tone', next as SectionFormValues['tone'])}
              >
                <SelectTrigger aria-labelledby={`${fieldId}-tone-label`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="brand">{text(labels, 'toneBrand')}</SelectItem>
                  <SelectItem value="accent">{text(labels, 'toneAccent')}</SelectItem>
                  <SelectItem value="neutral">{text(labels, 'toneNeutral')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </FormSection>
      ) : null}

      {fields.products ? (
        <FormSection title={text(labels, 'listingSectionTitle')}>
          <ContentProductPicker
            value={values.products}
            onChange={(next) => set('products', next)}
            locale={locale}
            labels={pickerLabels}
            fieldLabel={text(labels, 'fieldProducts')}
            error={errors.products}
          />
        </FormSection>
      ) : null}

      {fields.categories ? (
        <FormSection title={text(labels, 'listingSectionTitle')}>
          <ContentCategoryPicker
            value={values.categories}
            onChange={(next) => set('categories', next)}
            options={categories}
            labels={pickerLabels}
            fieldLabel={text(labels, 'fieldCategories')}
            error={errors.categories}
          />
        </FormSection>
      ) : null}

      {fields.categorySingle || fields.limit ? (
        <FormSection title={text(labels, 'listingSectionTitle')}>
          {fields.categorySingle ? (
            <div className="flex flex-col gap-1.5">
              <Label id={`${fieldId}-category-label`}>
                {text(labels, 'fieldCategoryOptional')}
              </Label>
              <Select
                value={values.categoryId === '' ? 'all' : values.categoryId}
                onValueChange={(next) => set('categoryId', next === 'all' ? '' : next)}
              >
                <SelectTrigger aria-labelledby={`${fieldId}-category-label`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{text(labels, 'categoryAllOption')}</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {fields.limit
            ? textField('limit', text(labels, 'fieldLimit'), {
                dir: 'ltr',
                help: text(labels, 'limitHelp'),
              })
            : null}
        </FormSection>
      ) : null}

      {fields.testimonials ? (
        <FormSection title={text(labels, 'testimonialsItems')}>
          <RepeatableItems
            items={values.testimonials}
            onChange={(next) => set('testimonials', next)}
            addLabel={text(labels, 'addTestimonial')}
            removeLabel={text(labels, 'removeItem')}
            itemLabel={text(labels, 'itemNumber')}
            error={errors.items}
            blank={{
              authorName: '',
              authorTitleAr: '',
              authorTitleEn: '',
              quoteAr: '',
              quoteEn: '',
              rating: '',
            }}
            render={(item, update, itemId) => (
              <>
                <FieldRow
                  id={`${itemId}-author`}
                  label={text(labels, 'authorName')}
                  value={item.authorName}
                  onChange={(value) => update({ ...item, authorName: value })}
                />
                <FieldRow
                  id={`${itemId}-quote-ar`}
                  label={text(labels, 'quoteAr')}
                  value={item.quoteAr}
                  dir="rtl"
                  multiline
                  onChange={(value) => update({ ...item, quoteAr: value })}
                />
                <FieldRow
                  id={`${itemId}-quote-en`}
                  label={text(labels, 'quoteEn')}
                  value={item.quoteEn}
                  dir="ltr"
                  multiline
                  onChange={(value) => update({ ...item, quoteEn: value })}
                />
                <FieldRow
                  id={`${itemId}-title-ar`}
                  label={text(labels, 'authorTitleAr')}
                  value={item.authorTitleAr}
                  dir="rtl"
                  onChange={(value) => update({ ...item, authorTitleAr: value })}
                />
                <FieldRow
                  id={`${itemId}-title-en`}
                  label={text(labels, 'authorTitleEn')}
                  value={item.authorTitleEn}
                  dir="ltr"
                  onChange={(value) => update({ ...item, authorTitleEn: value })}
                />
                <div className="flex flex-col gap-1.5">
                  <Label id={`${itemId}-rating-label`}>{text(labels, 'ratingLabel')}</Label>
                  <Select
                    value={item.rating === '' ? 'none' : item.rating}
                    onValueChange={(value) =>
                      update({ ...item, rating: value === 'none' ? '' : value })
                    }
                  >
                    <SelectTrigger aria-labelledby={`${itemId}-rating-label`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{text(labels, 'ratingNone')}</SelectItem>
                      {[1, 2, 3, 4, 5].map((rating) => (
                        <SelectItem key={rating} value={String(rating)}>
                          {rating}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          />
        </FormSection>
      ) : null}

      {fields.trustBlocks ? (
        <FormSection title={text(labels, 'trustBlocksItems')}>
          <RepeatableItems
            items={values.trustBlocks}
            onChange={(next) => set('trustBlocks', next)}
            addLabel={text(labels, 'addTrustBlock')}
            removeLabel={text(labels, 'removeItem')}
            itemLabel={text(labels, 'itemNumber')}
            error={errors.items}
            blank={{
              icon: 'BadgeCheck',
              titleAr: '',
              titleEn: '',
              descriptionAr: '',
              descriptionEn: '',
            }}
            render={(item, update, itemId) => (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label id={`${itemId}-icon-label`}>{text(labels, 'blockIcon')}</Label>
                  <Select
                    value={item.icon}
                    onValueChange={(value) => update({ ...item, icon: value })}
                  >
                    <SelectTrigger aria-labelledby={`${itemId}-icon-label`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRUST_BLOCK_ICON_NAMES.map((icon) => (
                        <SelectItem key={icon} value={icon}>
                          {labels.icons[icon] ?? icon}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <FieldRow
                  id={`${itemId}-title-ar`}
                  label={text(labels, 'blockTitleAr')}
                  value={item.titleAr}
                  dir="rtl"
                  onChange={(value) => update({ ...item, titleAr: value })}
                />
                <FieldRow
                  id={`${itemId}-title-en`}
                  label={text(labels, 'blockTitleEn')}
                  value={item.titleEn}
                  dir="ltr"
                  onChange={(value) => update({ ...item, titleEn: value })}
                />
                <FieldRow
                  id={`${itemId}-desc-ar`}
                  label={text(labels, 'blockDescriptionAr')}
                  value={item.descriptionAr}
                  dir="rtl"
                  onChange={(value) => update({ ...item, descriptionAr: value })}
                />
                <FieldRow
                  id={`${itemId}-desc-en`}
                  label={text(labels, 'blockDescriptionEn')}
                  value={item.descriptionEn}
                  dir="ltr"
                  onChange={(value) => update({ ...item, descriptionEn: value })}
                />
              </>
            )}
          />
        </FormSection>
      ) : null}

      {mode === 'create' ? (
        <FormSection
          title={text(labels, 'visibilityTitle')}
          description={text(labels, 'visibilityDescription')}
        >
          <div className="flex items-center gap-3">
            <Switch id={`${fieldId}-enabled`} checked={enabled} onCheckedChange={setEnabled} />
            <Label htmlFor={`${fieldId}-enabled`}>{text(labels, 'visibleLabel')}</Label>
          </div>
        </FormSection>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2 pt-6">
        {mode === 'edit' ? (
          <Button
            type="button"
            variant="outline"
            loading={saving === 'draft'}
            disabled={saving !== null}
            onClick={() => void submit('draft')}
          >
            {text(labels, 'saveDraft')}
          </Button>
        ) : null}
        <Button type="submit" loading={saving === 'publish'} disabled={saving !== null}>
          {mode === 'create' ? text(labels, 'addSection') : text(labels, 'saveAndPublish')}
        </Button>
      </div>
    </form>
  );
}

function FieldRow({
  id,
  label,
  value,
  onChange,
  dir,
  multiline = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  dir?: 'ltr' | 'rtl';
  multiline?: boolean;
}) {
  const Control = multiline ? Textarea : Input;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Control
        id={id}
        dir={dir}
        rows={multiline ? 2 : undefined}
        value={value}
        onChange={(event: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) =>
          onChange(event.target.value)
        }
      />
    </div>
  );
}

/**
 * The testimonial and trust-block lists.
 *
 * Items are keyed by index rather than by a generated id: these are small,
 * ordered, purely local lists that are rebuilt whole on every change, so an
 * index is stable for exactly as long as it needs to be and there is no
 * synthetic id to persist alongside data the schema doesn't have a field
 * for.
 */
function RepeatableItems<T>({
  items,
  onChange,
  blank,
  render,
  addLabel,
  removeLabel,
  itemLabel,
  error,
}: {
  items: T[];
  onChange: (next: T[]) => void;
  blank: T;
  render: (item: T, update: (next: T) => void, itemId: string) => React.ReactNode;
  addLabel: string;
  removeLabel: string;
  itemLabel: string;
  error?: string;
}) {
  const listId = useId();

  return (
    <div className="flex flex-col gap-4">
      {items.map((item, index) => {
        const heading = itemLabel.replace('{n}', String(index + 1));
        return (
          <fieldset
            key={index}
            className="flex flex-col gap-3 rounded-(--radius-container) border border-(--color-border) p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <legend className="text-label text-(--color-text)">{heading}</legend>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${removeLabel} — ${heading}`}
                onClick={() => onChange(items.filter((_, candidate) => candidate !== index))}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
            {render(
              item,
              (next) =>
                onChange(items.map((current, candidate) => (candidate === index ? next : current))),
              `${listId}-${index}`,
            )}
          </fieldset>
        );
      })}

      {error ? (
        <p role="alert" className="text-small text-(--color-error)">
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => onChange([...items, blank])}
      >
        <Plus className="size-4" aria-hidden="true" />
        {addLabel}
      </Button>
    </div>
  );
}
