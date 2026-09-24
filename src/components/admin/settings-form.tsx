'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Image from 'next/image';
import { X } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { updateStoreSettingsAction } from '@/lib/admin/settings-actions';
import type { Locale } from '@/lib/i18n/locales';

export interface SettingsFormValues {
  storeNameAr: string;
  storeNameEn: string;
  currency: string;
  defaultLocale: 'AR' | 'EN';
  whatsappNumber: string;
  contactPhone: string;
  contactEmail: string;
  contactAddress: string;
  instagram: string;
  x: string;
  facebook: string;
  tiktok: string;
  youtube: string;
  seoTitleAr: string;
  seoTitleEn: string;
  seoDescriptionAr: string;
  seoDescriptionEn: string;
}

export interface SettingsMedia {
  logo: { id: string; src: string } | null;
  logoDark: { id: string; src: string } | null;
  favicon: { id: string; src: string } | null;
}

export type SettingsFormLabels = Record<string, string>;

type MediaSlot = keyof SettingsMedia;

/**
 * The store's one settings row, as a form (P15).
 *
 * Plain `useState` rather than react-hook-form: every field here is a
 * string, there is no cross-field validation to express, and the real
 * validation is `storeSettingsInputSchema` on the server — a second copy of
 * it in the browser would be a second thing to keep in sync for no
 * additional safety. The three field-level messages below are the ones
 * worth catching before a round trip.
 *
 * `expectedUpdatedAt` is carried through the save and replaced with what the
 * server returns, so a second save from the same open form is not treated
 * as stale. A save that *is* stale (someone else changed the row) comes back
 * as `settings_changed_elsewhere` and is shown, not silently retried.
 */
export function SettingsForm({
  locale,
  initialValues,
  initialMedia,
  initialUpdatedAt,
  labels,
}: {
  locale: Locale;
  initialValues: SettingsFormValues;
  initialMedia: SettingsMedia;
  /** ISO string, or null when the row has never been saved. Serialized
   * because a `Date` cannot cross the Server → Client props boundary. */
  initialUpdatedAt: string | null;
  labels: SettingsFormLabels;
}) {
  const router = useRouter();
  const [values, setValues] = useState<SettingsFormValues>(initialValues);
  const [media, setMedia] = useState<SettingsMedia>(initialMedia);
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function set<K extends keyof SettingsFormValues>(key: K, value: SettingsFormValues[K]): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const currencyInvalid = values.currency.trim() !== '' && !/^[A-Za-z]{3}$/.test(values.currency);
  const emailInvalid =
    values.contactEmail.trim() !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.contactEmail);
  const socialFields: { key: keyof SettingsFormValues; label: string }[] = [
    { key: 'instagram', label: labels.socialInstagram! },
    { key: 'x', label: labels.socialX! },
    { key: 'facebook', label: labels.socialFacebook! },
    { key: 'tiktok', label: labels.socialTiktok! },
    { key: 'youtube', label: labels.socialYoutube! },
  ];
  const badUrl = (value: string) => value.trim() !== '' && !/^https?:\/\/\S+$/.test(value);
  const anyUrlInvalid = socialFields.some((field) => badUrl(String(values[field.key])));
  const blocked = currencyInvalid || emailInvalid || anyUrlInvalid;

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (blocked) return;
    setSaving(true);
    setFormError(null);

    const result = await updateStoreSettingsAction(
      {
        storeNameAr: values.storeNameAr,
        storeNameEn: values.storeNameEn,
        currency: values.currency,
        defaultLocale: values.defaultLocale,
        whatsappNumber: values.whatsappNumber,
        contact: {
          phone: values.contactPhone,
          email: values.contactEmail,
          address: values.contactAddress,
        },
        socialLinks: {
          instagram: values.instagram,
          x: values.x,
          facebook: values.facebook,
          tiktok: values.tiktok,
          youtube: values.youtube,
        },
        seoDefaults: {
          titleAr: values.seoTitleAr,
          titleEn: values.seoTitleEn,
          descriptionAr: values.seoDescriptionAr,
          descriptionEn: values.seoDescriptionEn,
        },
        logoMediaId: media.logo?.id ?? '',
        logoDarkMediaId: media.logoDark?.id ?? '',
        faviconMediaId: media.favicon?.id ?? '',
      },
      updatedAt ? new Date(updatedAt) : null,
      locale,
    );

    setSaving(false);
    if (!result.ok) {
      setFormError(result.error ?? null);
      return;
    }
    setUpdatedAt(result.data?.updatedAt ? new Date(result.data.updatedAt).toISOString() : null);
    toast({ title: labels.saved!, variant: 'success' });
    router.refresh();
  }

  function mediaSlot(slot: MediaSlot, label: string) {
    const current = media[slot];
    return (
      <div className="flex flex-col gap-1.5">
        <Label>{label}</Label>
        {current ? (
          <div className="flex items-center gap-3">
            <div className="relative size-16 overflow-hidden rounded-(--radius-control) border border-(--color-border) bg-(--color-surface)">
              <Image src={current.src} alt="" fill sizes="64px" className="object-contain" />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`${labels.remove} — ${label}`}
              onClick={() => setMedia((value) => ({ ...value, [slot]: null }))}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <MediaUploader
            context="branding"
            onUploaded={(asset) =>
              setMedia((value) => ({ ...value, [slot]: { id: asset.id, src: asset.src } }))
            }
            labels={{
              chooseFile: labels.chooseFile!,
              uploading: labels.uploading!,
              error: labels.uploadError!,
            }}
          />
        )}
      </div>
    );
  }

  function textField(
    key: keyof SettingsFormValues,
    label: string,
    options: { dir?: 'ltr' | 'rtl'; help?: string; error?: string; type?: string } = {},
  ) {
    const id = `settings-${key}`;
    const hasError = Boolean(options.error);
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          type={options.type ?? 'text'}
          dir={options.dir}
          value={String(values[key])}
          onChange={(event) => set(key, event.target.value as SettingsFormValues[typeof key])}
          aria-invalid={hasError ? true : undefined}
          aria-describedby={options.help || hasError ? `${id}-help` : undefined}
        />
        {options.help || hasError ? (
          <p
            id={`${id}-help`}
            className={
              hasError
                ? 'text-small text-(--color-error)'
                : 'text-caption text-(--color-text-muted)'
            }
          >
            {options.error ?? options.help}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col divide-y divide-(--color-border)">
      {formError ? (
        <Alert variant="error" role="alert" className="mb-6">
          {formError}
        </Alert>
      ) : null}

      {updatedAt === null ? (
        <Alert variant="info" className="mb-6">
          {labels.notYetCreated}
        </Alert>
      ) : null}

      <FormSection title={labels.identityTitle!} description={labels.identityDescription}>
        {textField('storeNameEn', labels.storeNameEn!, { dir: 'ltr' })}
        {textField('storeNameAr', labels.storeNameAr!, { dir: 'rtl' })}
      </FormSection>

      <FormSection title={labels.localeTitle!} description={labels.localeDescription}>
        {textField('currency', labels.currency!, {
          dir: 'ltr',
          help: labels.currencyHelp,
          error: currencyInvalid ? labels.invalidCurrency : undefined,
        })}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-default-locale">{labels.defaultLocale}</Label>
          <Select
            value={values.defaultLocale}
            onValueChange={(value) => set('defaultLocale', value as 'AR' | 'EN')}
          >
            <SelectTrigger id="settings-default-locale">
              <SelectValue>
                {values.defaultLocale === 'AR' ? labels.localeAr : labels.localeEn}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AR">{labels.localeAr}</SelectItem>
              <SelectItem value="EN">{labels.localeEn}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FormSection>

      <FormSection title={labels.brandingTitle!} description={labels.brandingDescription}>
        {mediaSlot('logo', labels.logo!)}
        {mediaSlot('logoDark', labels.logoDark!)}
        {mediaSlot('favicon', labels.favicon!)}
      </FormSection>

      <FormSection title={labels.contactTitle!} description={labels.contactDescription}>
        {textField('contactPhone', labels.contactPhone!, { dir: 'ltr' })}
        {textField('contactEmail', labels.contactEmail!, {
          dir: 'ltr',
          type: 'email',
          error: emailInvalid ? labels.invalidEmail : undefined,
        })}
        {textField('contactAddress', labels.contactAddress!)}
        {textField('whatsappNumber', labels.whatsappNumber!, {
          dir: 'ltr',
          help: labels.whatsappHelp,
        })}
      </FormSection>

      <FormSection title={labels.socialTitle!} description={labels.socialDescription}>
        {socialFields.map((field) => (
          <div key={field.key}>
            {textField(field.key, field.label, {
              dir: 'ltr',
              error: badUrl(String(values[field.key])) ? labels.invalidUrl : undefined,
            })}
          </div>
        ))}
      </FormSection>

      <FormSection title={labels.seoTitle!} description={labels.seoDescription}>
        {textField('seoTitleEn', labels.seoTitleEn!, { dir: 'ltr' })}
        {textField('seoTitleAr', labels.seoTitleAr!, { dir: 'rtl' })}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-seo-description-en">{labels.seoDescriptionEn}</Label>
          <Textarea
            id="settings-seo-description-en"
            dir="ltr"
            rows={3}
            value={values.seoDescriptionEn}
            onChange={(event) => set('seoDescriptionEn', event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-seo-description-ar">{labels.seoDescriptionAr}</Label>
          <Textarea
            id="settings-seo-description-ar"
            dir="rtl"
            rows={3}
            value={values.seoDescriptionAr}
            onChange={(event) => set('seoDescriptionAr', event.target.value)}
          />
        </div>
      </FormSection>

      <div className="flex items-center gap-3 pt-6">
        <Button type="submit" loading={saving} disabled={saving || blocked}>
          {saving ? labels.saving : labels.save}
        </Button>
      </div>
    </form>
  );
}
