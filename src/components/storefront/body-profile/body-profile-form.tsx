'use client';

import { useActionState, useEffect, useId, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Ruler, Trash2 } from 'lucide-react';

// Dependency-free files of the module (type-only Prisma imports), shared
// with the server's validation so the form reads input exactly as it does.
import {
  FACIAL_HAIR,
  GENDERS,
  GLASSES_FRAME_COLORS,
  GLASSES_STYLES,
  HAIR_COLORS,
  HAIR_STYLES,
  MEASUREMENT_BOUNDS,
  MEASUREMENT_KEYS,
  OPTIONAL_MEASUREMENTS,
  REQUIRED_MEASUREMENTS,
  SKIN_TONES,
  type MeasurementKey,
} from '@/modules/body-profile/options';
import { checkMeasurement } from '@/modules/body-profile/measurement-input';
import { computeProfileCompletion } from '@/modules/body-profile/profile-completion';
import type {
  BodyProfileErrorCode,
  BodyProfileField,
  BodyProfileSnapshot,
} from '@/modules/body-profile';
import {
  deleteBodyProfileAction,
  saveBodyProfileAction,
  type BodyProfileFormState,
} from '@/lib/customers/body-profile-actions';
import type { AvatarAppearance, AvatarRenderInput } from '@/lib/avatar/avatar-model';
import type { Locale } from '@/lib/i18n/locales';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';

import { AvatarPreview } from './avatar/avatar-renderer';
import { ChoiceGroup, type ChoiceOption } from './choice-group';
import { CompletionCard } from './completion-card';
import type { BodyProfileLabels } from './labels';
import { MeasurementField } from './measurement-field';

export type { BodyProfileLabels } from './labels';

interface Values {
  gender: string;
  measurements: Record<MeasurementKey, string>;
  skinTone: string;
  hairStyle: string;
  hairColor: string;
  facialHair: string;
  wearsGlasses: boolean;
  glassesStyle: string;
  glassesFrameColor: string;
}

function valuesFrom(profile: BodyProfileSnapshot | null): Values {
  const measurements = Object.fromEntries(
    MEASUREMENT_KEYS.map((key) => {
      const value = profile?.measurements[key];
      return [key, typeof value === 'number' ? String(value) : ''];
    }),
  ) as Record<MeasurementKey, string>;
  const a = profile?.avatar;
  return {
    gender: profile?.gender ?? '',
    measurements,
    skinTone: a?.skinTone ?? '',
    hairStyle: a?.hairStyle ?? '',
    hairColor: a?.hairColor ?? '',
    facialHair: a?.facialHair ?? '',
    wearsGlasses: a?.wearsGlasses ?? false,
    glassesStyle: a?.glassesStyle ?? '',
    glassesFrameColor: a?.glassesFrameColor ?? '',
  };
}

const IDLE: BodyProfileFormState = { status: 'idle' };
const swatch = (group: string, value: string) =>
  `var(--avatar-${group}-${value.toLowerCase().replaceAll('_', '-')})`;

/**
 * The fit profile form: basic information, measurements, appearance, and a
 * live illustration beside them.
 *
 * Every value is controlled state so the illustration and the completeness
 * score follow the customer's typing; the save itself is a plain Server
 * Action over the form's fields, and validation is the server's (the same
 * schema the service enforces) — this component parses numbers only to
 * draw them. Nothing here holds or sends an id: the profile it edits is
 * whichever one the signed-in session owns.
 */
export function BodyProfileForm({
  locale,
  labels,
  initialProfile,
}: {
  locale: Locale;
  labels: BodyProfileLabels;
  initialProfile: BodyProfileSnapshot | null;
}) {
  const router = useRouter();
  const idBase = useId();
  const fieldId = (field: BodyProfileField) => `${idBase}-${field}`;
  const direction = locale === 'ar' ? 'rtl' : 'ltr';

  const [values, setValues] = useState<Values>(() => valuesFrom(initialProfile));
  const [savedValues, setSavedValues] = useState<Values>(() => valuesFrom(initialProfile));
  const [version, setVersion] = useState(initialProfile?.updatedAt ?? '');
  const [fieldErrors, setFieldErrors] = useState<BodyProfileFormState['fieldErrors']>({});
  const [formError, setFormError] = useState<BodyProfileFormState['formError']>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();
  const [, startSave] = useTransition();

  const boundSave = saveBodyProfileAction.bind(null, locale);
  const [state, formAction, isSaving] = useActionState(boundSave, IDLE);

  // Each finished submission updates the form once, during render — React's
  // "adjust state when an input changes" pattern, rather than an effect that
  // sets state and renders twice.
  const [handledState, setHandledState] = useState<BodyProfileFormState>(IDLE);
  if (state !== handledState) {
    setHandledState(state);
    if (state.status === 'saved' && state.profile) {
      const next = valuesFrom(state.profile);
      setValues(next);
      setSavedValues(next);
      setVersion(state.profile.updatedAt);
      setFieldErrors({});
      setFormError(undefined);
    } else if (state.status === 'error') {
      setFieldErrors(state.fieldErrors ?? {});
      setFormError(state.formError);
    }
  }

  // …and its side effects — the toast, and focus on the first invalid field.
  useEffect(() => {
    if (state.status === 'saved') {
      toast({ title: labels.saved, variant: 'success' });
    } else if (state.status === 'error') {
      const firstInvalid = Object.keys(state.fieldErrors ?? {})[0] as BodyProfileField | undefined;
      if (firstInvalid && firstInvalid !== 'form') {
        // A choice group's id is on its radiogroup; focus lands on a radio.
        const target = document.getElementById(`${idBase}-${firstInvalid}`);
        const radio = target?.querySelector<HTMLElement>('[role="radio"]');
        (radio ?? target)?.focus();
      }
    }
  }, [state, labels.saved, idBase]);

  const clearError = (field: BodyProfileField) =>
    setFieldErrors((current) => {
      if (!current?.[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });

  const setMeasurement = (key: MeasurementKey, raw: string) => {
    setValues((v) => ({ ...v, measurements: { ...v.measurements, [key]: raw } }));
    clearError(key);
  };
  const setChoice = (
    field: Exclude<keyof Values, 'measurements' | 'wearsGlasses'>,
    value: string,
  ) => {
    setValues((v) => ({ ...v, [field]: value }));
    clearError(field);
  };

  // What the form currently says, read the way the server will read it.
  const parsed = useMemo(
    () =>
      Object.fromEntries(
        MEASUREMENT_KEYS.map((key) => [key, checkMeasurement(key, values.measurements[key]).value]),
      ) as Record<MeasurementKey, number | null>,
    [values.measurements],
  );
  const appearance: AvatarAppearance = {
    skinTone: (values.skinTone || null) as AvatarAppearance['skinTone'],
    hairStyle: (values.hairStyle || null) as AvatarAppearance['hairStyle'],
    hairColor: (values.hairColor || null) as AvatarAppearance['hairColor'],
    facialHair: (values.facialHair || null) as AvatarAppearance['facialHair'],
    wearsGlasses: values.wearsGlasses,
    glassesStyle: (values.wearsGlasses && values.glassesStyle
      ? values.glassesStyle
      : null) as AvatarAppearance['glassesStyle'],
    glassesFrameColor: (values.wearsGlasses && values.glassesFrameColor
      ? values.glassesFrameColor
      : null) as AvatarAppearance['glassesFrameColor'],
  };
  const avatarInput: AvatarRenderInput = { measurements: parsed, appearance };
  const completion = computeProfileCompletion({
    gender: values.gender || null,
    measurements: parsed,
    appearance: {
      skinTone: appearance.skinTone,
      hairStyle: appearance.hairStyle,
      hairColor: appearance.hairColor,
    },
  });
  const dirty = JSON.stringify(values) !== JSON.stringify(savedValues);
  const hasProfile = version !== '';
  const covered = values.hairStyle === 'COVERED';

  const unitLabel = (key: MeasurementKey) => labels.units[MEASUREMENT_BOUNDS[key].unit];
  const errorMessage = (field: BodyProfileField, code: BodyProfileErrorCode | undefined) => {
    if (!code || code === 'unknown_field') return undefined;
    if (field in MEASUREMENT_BOUNDS && (code === 'too_small' || code === 'too_large')) {
      const key = field as MeasurementKey;
      const { min, max } = MEASUREMENT_BOUNDS[key];
      return labels.errors[code]
        .replace('{min}', String(min))
        .replace('{max}', String(max))
        .replace('{unit}', unitLabel(key));
    }
    return labels.errors[code];
  };

  const formErrorText =
    formError === 'invalid'
      ? labels.errors.summary
      : formError === 'stale'
        ? labels.errors.stale
        : formError === 'session_expired'
          ? labels.errors.sessionExpired
          : formError === 'generic'
            ? labels.errors.generic
            : undefined;

  const listSeparator = locale === 'ar' ? '، ' : ', ';
  const heightText =
    parsed.heightCm !== null ? `${parsed.heightCm} ${labels.units.cm}` : labels.preview.heightUnset;
  const previewDescription = [
    parsed.heightCm !== null ? `${labels.measurements.heightCm.label}: ${heightText}` : null,
    appearance.skinTone ? labels.appearance.skinTone.options[appearance.skinTone] : null,
    appearance.hairStyle ? labels.appearance.hairStyle.options[appearance.hairStyle] : null,
    appearance.hairColor && !covered
      ? labels.appearance.hairColor.options[appearance.hairColor]
      : null,
    appearance.facialHair && appearance.facialHair !== 'NONE'
      ? labels.appearance.facialHair.options[appearance.facialHair]
      : null,
    appearance.wearsGlasses
      ? `${labels.preview.glasses}${appearance.glassesStyle ? ` (${labels.appearance.glasses.style.options[appearance.glassesStyle]})` : ''}`
      : null,
  ]
    .filter(Boolean)
    .join(listSeparator);

  const UNSET = '__unset';
  const withUnset = <T extends string>(
    options: readonly T[],
    optionLabels: Record<T, string>,
    group?: string,
  ) => [
    { value: UNSET, label: labels.appearance.notSpecified },
    ...options.map((value) => ({
      value,
      label: optionLabels[value],
      ...(group ? { swatch: swatch(group, value) } : {}),
    })),
  ];
  const toGroupValue = (value: string) => value || UNSET;
  const fromGroupValue = (value: string) => (value === UNSET ? '' : value);

  const onDelete = () =>
    startDelete(async () => {
      const result = await deleteBodyProfileAction(locale);
      if (!result.ok) {
        setDeleteOpen(false);
        setFormError(result.error);
        return;
      }
      const empty = valuesFrom(null);
      setValues(empty);
      setSavedValues(empty);
      setVersion('');
      setFieldErrors({});
      setFormError(undefined);
      setDeleteOpen(false);
      toast({ title: labels.delete.deleted, variant: 'success' });
      router.refresh();
    });

  const genderOptions: ChoiceOption[] = GENDERS.map((value) => ({
    value,
    label: labels.gender.options[value],
  }));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
      {/* The illustration and the completeness score: beside the form on a
          wide screen, above it on a narrow one. */}
      <aside
        className="flex flex-col gap-4 lg:sticky lg:top-24 lg:order-2"
        aria-label={labels.preview.title}
      >
        <Card>
          <CardHeader>
            <CardTitle>{labels.preview.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div
              className="mx-auto w-full max-w-44 rounded-(--radius-surface) bg-(--color-surface-raised) p-2 sm:max-w-52 lg:max-w-60"
              data-testid="avatar-preview"
            >
              <AvatarPreview
                input={avatarInput}
                title={labels.preview.title}
                description={previewDescription || labels.preview.caption}
                heightLabel={heightText}
                direction={direction}
              />
            </div>
            <p className="text-caption text-(--color-text-subtle)">{labels.preview.caption}</p>
            {parsed.heightCm === null ? (
              <p className="text-small text-(--color-text-muted)">{labels.preview.heightUnset}</p>
            ) : null}
          </CardContent>
        </Card>
        <CompletionCard
          completion={completion}
          labels={labels.completion}
          sectionTitles={{
            basic: labels.sections.basic.title,
            measurements: labels.sections.measurements.title,
            appearance: labels.sections.appearance.title,
          }}
        />
      </aside>

      {/* Submitted by hand rather than through `action={formAction}`: React
          resets a form after a successful `action` submission, and Radix's
          radio groups and switch answer that reset by pushing their defaults
          back into this component's state — every choice would read as
          unset right after saving it. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          startSave(() => formAction(data));
        }}
        noValidate
        className="flex min-w-0 flex-col gap-6 lg:order-1"
      >
        {formErrorText ? (
          <Alert variant="error" data-testid="body-profile-form-error">
            {formErrorText}
          </Alert>
        ) : null}

        <input type="hidden" name="expectedUpdatedAt" value={version} />
        <input type="hidden" name="gender" value={values.gender} />
        <input type="hidden" name="skinTone" value={values.skinTone} />
        <input type="hidden" name="hairStyle" value={values.hairStyle} />
        <input type="hidden" name="hairColor" value={covered ? '' : values.hairColor} />
        <input type="hidden" name="facialHair" value={values.facialHair} />
        <input type="hidden" name="wearsGlasses" value={values.wearsGlasses ? 'true' : 'false'} />
        <input
          type="hidden"
          name="glassesStyle"
          value={values.wearsGlasses ? values.glassesStyle : ''}
        />
        <input
          type="hidden"
          name="glassesFrameColor"
          value={values.wearsGlasses ? values.glassesFrameColor : ''}
        />

        {/* 1. Basic information */}
        <Card>
          <CardHeader>
            <CardTitle>{labels.sections.basic.title}</CardTitle>
            <CardDescription>{labels.sections.basic.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <ChoiceGroup
              id={fieldId('gender')}
              label={labels.gender.label}
              help={labels.gender.help}
              required
              requiredMark={labels.requiredMark}
              value={values.gender || undefined}
              onChange={(value) => setChoice('gender', value)}
              options={genderOptions}
              error={errorMessage('gender', fieldErrors?.gender)}
              direction={direction}
              layout="grid"
            />
          </CardContent>
        </Card>

        {/* 2. Measurements */}
        <Card>
          <CardHeader className="gap-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <CardTitle>{labels.sections.measurements.title}</CardTitle>
              <MeasuringGuide labels={labels} />
            </div>
            <CardDescription>{labels.sections.measurements.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {(
              [
                ['required', REQUIRED_MEASUREMENTS],
                ['optional', OPTIONAL_MEASUREMENTS],
              ] as const
            ).map(([group, keys]) => (
              <fieldset key={group} className="flex flex-col gap-4">
                <legend className="mb-3 text-label font-semibold text-(--color-text-muted) uppercase">
                  {labels.sections.measurements[group]}
                </legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  {keys.map((key) => (
                    <MeasurementField
                      key={key}
                      id={fieldId(key)}
                      name={key}
                      label={labels.measurements[key].label}
                      help={labels.measurements[key].help}
                      unit={unitLabel(key)}
                      required={group === 'required'}
                      requiredMark={labels.requiredMark}
                      optionalMark={labels.optionalMark}
                      value={values.measurements[key]}
                      onChange={(raw) => setMeasurement(key, raw)}
                      error={errorMessage(key, fieldErrors?.[key])}
                    />
                  ))}
                </div>
              </fieldset>
            ))}
          </CardContent>
        </Card>

        {/* 3. Appearance */}
        <Card>
          <CardHeader>
            <CardTitle>{labels.sections.appearance.title}</CardTitle>
            <CardDescription>{labels.sections.appearance.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <ChoiceGroup
              id={fieldId('skinTone')}
              label={labels.appearance.skinTone.label}
              value={toGroupValue(values.skinTone)}
              onChange={(value) => setChoice('skinTone', fromGroupValue(value))}
              options={withUnset(SKIN_TONES, labels.appearance.skinTone.options, 'skin')}
              error={errorMessage('skinTone', fieldErrors?.skinTone)}
              direction={direction}
            />
            <ChoiceGroup
              id={fieldId('hairStyle')}
              label={labels.appearance.hairStyle.label}
              value={toGroupValue(values.hairStyle)}
              onChange={(value) => setChoice('hairStyle', fromGroupValue(value))}
              options={withUnset(HAIR_STYLES, labels.appearance.hairStyle.options)}
              error={errorMessage('hairStyle', fieldErrors?.hairStyle)}
              direction={direction}
            />
            {covered ? (
              <p className="text-small text-(--color-text-muted)">
                {labels.appearance.hairColor.coveredNote}
              </p>
            ) : (
              <ChoiceGroup
                id={fieldId('hairColor')}
                label={labels.appearance.hairColor.label}
                value={toGroupValue(values.hairColor)}
                onChange={(value) => setChoice('hairColor', fromGroupValue(value))}
                options={withUnset(HAIR_COLORS, labels.appearance.hairColor.options, 'hair')}
                error={errorMessage('hairColor', fieldErrors?.hairColor)}
                direction={direction}
              />
            )}
            <ChoiceGroup
              id={fieldId('facialHair')}
              label={labels.appearance.facialHair.label}
              value={values.facialHair || undefined}
              onChange={(value) => setChoice('facialHair', value)}
              options={FACIAL_HAIR.map((value) => ({
                value,
                label: labels.appearance.facialHair.options[value],
              }))}
              error={errorMessage('facialHair', fieldErrors?.facialHair)}
              direction={direction}
            />

            <div className="flex flex-col gap-4 rounded-(--radius-control) border border-(--color-border) p-4">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={fieldId('wearsGlasses')} className="cursor-pointer">
                  {labels.appearance.glasses.label}
                </Label>
                <Switch
                  id={fieldId('wearsGlasses')}
                  checked={values.wearsGlasses}
                  onCheckedChange={(checked) => setValues((v) => ({ ...v, wearsGlasses: checked }))}
                />
              </div>
              {values.wearsGlasses ? (
                <>
                  <ChoiceGroup
                    id={fieldId('glassesStyle')}
                    label={labels.appearance.glasses.style.label}
                    value={values.glassesStyle || undefined}
                    onChange={(value) => setChoice('glassesStyle', value)}
                    options={GLASSES_STYLES.map((value) => ({
                      value,
                      label: labels.appearance.glasses.style.options[value],
                    }))}
                    error={errorMessage('glassesStyle', fieldErrors?.glassesStyle)}
                    direction={direction}
                  />
                  <ChoiceGroup
                    id={fieldId('glassesFrameColor')}
                    label={labels.appearance.glasses.frameColor.label}
                    value={values.glassesFrameColor || undefined}
                    onChange={(value) => setChoice('glassesFrameColor', value)}
                    options={GLASSES_FRAME_COLORS.map((value) => ({
                      value,
                      label: labels.appearance.glasses.frameColor.options[value],
                      swatch: swatch('frame', value),
                    }))}
                    error={errorMessage('glassesFrameColor', fieldErrors?.glassesFrameColor)}
                    direction={direction}
                  />
                </>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4 rounded-(--radius-surface) border border-(--color-border) bg-(--color-surface) p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-h-6 flex-wrap items-center gap-2 text-small text-(--color-text-muted)">
            {dirty ? (
              <Badge variant="warning" data-testid="body-profile-unsaved">
                {labels.unsaved}
              </Badge>
            ) : null}
            {!completion.requiredComplete ? <span>{labels.completion.requiredMissing}</span> : null}
          </div>
          <Button type="submit" disabled={isSaving || isDeleting} className="sm:min-w-40">
            {isSaving ? labels.saving : labels.save}
          </Button>
        </div>

        {hasProfile ? (
          <div className="flex justify-end">
            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <DialogTrigger asChild>
                <Button type="button" variant="ghost" className="text-(--color-error)">
                  <Trash2 aria-hidden="true" />
                  {labels.delete.button}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>{labels.delete.title}</DialogTitle>
                  <DialogDescription>{labels.delete.description}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button type="button" variant="outline">
                      {labels.delete.cancel}
                    </Button>
                  </DialogClose>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={onDelete}
                    disabled={isDeleting}
                  >
                    {isDeleting ? labels.delete.deleting : labels.delete.confirm}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        ) : null}
      </form>
    </div>
  );
}

function MeasuringGuide({ labels }: { labels: BodyProfileLabels }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Ruler aria-hidden="true" />
          {labels.guide.open}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{labels.guide.title}</DialogTitle>
          <DialogDescription>{labels.guide.intro}</DialogDescription>
        </DialogHeader>
        <ul className="flex list-disc flex-col gap-1.5 ps-5 text-small text-(--color-text)">
          {labels.guide.tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
        <dl className="flex flex-col gap-3 text-small">
          {MEASUREMENT_KEYS.map((key) => (
            <div key={key}>
              <dt className="font-medium text-(--color-text)">{labels.measurements[key].label}</dt>
              <dd className="text-(--color-text-muted)">{labels.measurements[key].help}</dd>
            </div>
          ))}
        </dl>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button">{labels.guide.close}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
