'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Ruler, ShoppingBag } from 'lucide-react';

import { AvatarPreview } from '@/components/storefront/avatar/avatar-renderer';
import { ChoiceGroup } from '@/components/storefront/body-profile/choice-group';
import { MeasurementField } from '@/components/storefront/body-profile/measurement-field';
import { notifyCartChanged } from '@/components/storefront/cart/cart-events';
import { ProductPrice } from '@/components/commerce/product-price';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { avatarInputFromProfile } from '@/lib/avatar/avatar-model';
import { addToCartAction } from '@/lib/cart/cart-actions';
import {
  updateBodyMeasurementsAction,
  type BodyProfileFormState,
} from '@/lib/customers/body-profile-actions';
import type { FittingRoomData } from '@/lib/fitting/fitting-room';
import type { getDictionary } from '@/lib/i18n/dictionary';
import type { Locale } from '@/lib/i18n/locales';
import {
  MEASUREMENT_BOUNDS,
  MEASUREMENT_KEYS,
  REQUIRED_MEASUREMENTS,
  type MeasurementKey,
} from '@/modules/body-profile/options';
import type { FittingResult } from '@/modules/fitting';

import { garmentLayers } from './garment-layers';

type Dictionary = ReturnType<typeof getDictionary>;
type Ready = Extract<FittingRoomData, { status: 'ready' }>;

const FIT_ORDER = ['SLIM', 'REGULAR', 'RELAXED'] as const;
const IDLE: BodyProfileFormState = { status: 'idle' };

/**
 * The fitting room (clothing P04): the customer's avatar wearing the chosen
 * garment, and the choices beside it.
 *
 * Every size's fitting arrives computed by the server, so switching sizes
 * or colours is instant and needs no request; the URL follows along, so the
 * view can be shared or reloaded. Anything that changes the *calculation* —
 * another fit preference, new measurements — goes back to the server and
 * the page is recomputed from the database, never patched from what this
 * component holds.
 */
export function FittingRoom({
  locale,
  data,
  currency,
  t,
}: {
  locale: Locale;
  data: Ready;
  currency: string;
  t: Pick<Dictionary, 'fitting' | 'sizing' | 'bodyProfile' | 'product' | 'cart'>;
}) {
  const router = useRouter();
  const id = React.useId();
  const direction = locale === 'ar' ? 'rtl' : 'ltr';
  const L = t.fitting;
  const [colorId, setColorId] = React.useState(data.initial.colorId);
  const [sizeId, setSizeId] = React.useState(data.initial.sizeId);
  const [adding, setAdding] = React.useState(false);

  const name = (label: { ar: string; en: string }) => label[locale];
  const color = data.colors.find((c) => c.valueId === colorId) ?? null;
  const base = data.results.find((r) => r.size.sizeId === sizeId) ?? data.results[0]!;
  const result: FittingResult = { ...base, color };
  const recommendation = result.recommendation;
  const recommendedId = recommendation.status === 'recommended' ? recommendation.sizeId : null;
  const recommendedLabel = data.results.find((r) => r.size.sizeId === recommendedId)?.size.label;

  const variant = data.variants.find(
    (v) => v.optionValueIds.includes(sizeId) && (!colorId || v.optionValueIds.includes(colorId)),
  );
  const available = variant && variant.stockStatus !== 'out-of-stock';

  const syncUrl = (next: { color?: string | null; size?: string }) => {
    const params = new URLSearchParams(window.location.search);
    if (next.color) params.set('color', next.color);
    if (next.size) params.set('size', next.size);
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
  };
  const chooseSize = (value: string) => {
    setSizeId(value);
    syncUrl({ size: value });
  };
  const chooseColor = (value: string) => {
    setColorId(value);
    syncUrl({ color: value });
  };
  const chooseFit = (value: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set('fit', value);
    if (colorId) params.set('color', colorId);
    params.set('size', sizeId);
    // A new calculation: the server does it, from the database.
    router.replace(`${window.location.pathname}?${params}`, { scroll: false });
  };

  const relation = (() => {
    const r = result.relation;
    if (r.kind === 'recommended') return L.relation.recommended;
    if (r.kind === 'unknown') return L.relation.unknown;
    const prefix = r.kind === 'smaller' ? 'smaller' : 'larger';
    const key = `${prefix}${r.steps === 1 ? 'One' : r.steps === 2 ? 'Two' : 'Many'}` as const;
    return L.relation[key].replace('{count}', String(r.steps));
  })();

  const profileNames = (keys: readonly string[]) =>
    keys
      .map(
        (key) =>
          t.sizing.profileMeasurementNames[key as keyof typeof t.sizing.profileMeasurementNames],
      )
      .join(t.sizing.listJoin);

  const productName = name(data.product.name);
  const avatarDescription = (color ? L.avatarDescription : L.avatarDescriptionNoColor)
    .replace('{product}', productName)
    .replace('{color}', color ? name(color.label) : '')
    .replace('{size}', name(result.size.label));
  const fitWords = result.fit?.areas
    .map((area) => `${t.sizing.measurementNames[area.measurement]}: ${t.sizing.fits[area.fit]}`)
    .join(locale === 'ar' ? '، ' : ', ');

  const addToCart = async () => {
    if (!variant) return;
    setAdding(true);
    const response = await addToCartAction({ variantId: variant.id, quantity: 1 }, locale);
    setAdding(false);
    if (!response.ok) {
      toast({ title: response.error ?? t.cart.errors.outOfStock, variant: 'error' });
      return;
    }
    notifyCartChanged();
    toast({ title: t.cart.addedToCart, variant: 'success' });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
      <Card className="lg:sticky lg:top-24">
        <CardContent className="flex flex-col gap-3 p-4">
          <div
            className="mx-auto w-full max-w-60 sm:max-w-72 lg:max-w-80"
            data-testid="fitting-avatar"
          >
            <AvatarPreview
              input={avatarInputFromProfile(data.profile)}
              layers={garmentLayers(result)}
              title={L.avatarTitle}
              description={`${avatarDescription} ${fitWords ?? ''}`.trim()}
              heightLabel={`${data.profile.measurements.heightCm} ${t.bodyProfile.units.cm}`}
              direction={direction}
            />
          </div>
          <p className="text-center text-caption text-(--color-text-muted)">{L.intro}</p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Link
            href={`/${locale}/p/${data.product.slug}`}
            className="inline-flex items-center gap-1 self-start text-small text-(--color-text-muted) hover:text-(--color-text)"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
            {L.backToProduct}
          </Link>
          <h2 className="text-h4 text-(--color-text)">{productName}</h2>
          {data.product.fit ? (
            <p className="text-small text-(--color-text-muted)">
              {L.productFit.replace('{fit}', name(data.product.fit))}
            </p>
          ) : null}
          {variant ? (
            <ProductPrice
              priceMinor={variant.price.currentMinor}
              compareAtMinor={variant.price.compareAtMinor}
              currency={currency}
              locale={locale}
            />
          ) : null}
        </div>

        {data.colors.length > 0 ? (
          <ChoiceGroup
            id={`${id}-color`}
            label={L.color}
            value={colorId ?? undefined}
            onChange={chooseColor}
            options={data.colors.map((c) => ({
              value: c.valueId,
              label: name(c.label),
              ...(c.swatchHex ? { swatch: c.swatchHex } : {}),
            }))}
            direction={direction}
          />
        ) : null}

        <div className="flex flex-col gap-2">
          <ChoiceGroup
            id={`${id}-size`}
            label={L.size}
            value={sizeId}
            onChange={chooseSize}
            options={data.results.map((r) => ({
              value: r.size.sizeId,
              label:
                r.size.sizeId === recommendedId
                  ? `${name(r.size.label)} · ${L.recommendedBadge}`
                  : name(r.size.label),
            }))}
            direction={direction}
          />
          <div aria-live="polite" className="flex flex-col gap-1" data-testid="fitting-relation">
            {recommendedLabel ? (
              <p className="flex flex-wrap items-center gap-2 text-small text-(--color-text)">
                <Badge variant="success">{L.recommendedBadge}</Badge>
                {L.recommended.replace('{size}', name(recommendedLabel))}
              </p>
            ) : null}
            <p className="text-sm font-medium text-(--color-text)">
              {L.selected.replace('{size}', name(result.size.label))}
            </p>
            <p className="text-small text-(--color-text-muted)">{relation}</p>
            {recommendedId && recommendedId !== sizeId ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start"
                onClick={() => chooseSize(recommendedId)}
              >
                {L.useRecommended}
              </Button>
            ) : null}
            <p className="text-caption text-(--color-text-muted)">{L.choiceIsYours}</p>
          </div>
        </div>

        <section aria-labelledby={`${id}-fit-title`} className="flex flex-col gap-2">
          <h3 id={`${id}-fit-title`} className="text-sm font-semibold text-(--color-text)">
            {L.fitTitle}
          </h3>
          {result.fit ? (
            <>
              <p className="text-small text-(--color-text-muted)" data-testid="fitting-score">
                {L.fitScore.replace('{score}', String(result.fit.score))}
              </p>
              <ul className="flex flex-col gap-1" data-testid="fitting-areas">
                {result.fit.areas.map((area) => (
                  <li key={area.measurement} className="text-small text-(--color-text)">
                    {t.sizing.reasonMeasurement
                      .replace('{measurement}', t.sizing.measurementNames[area.measurement])
                      .replace('{fit}', t.sizing.fits[area.fit])}
                  </li>
                ))}
              </ul>
            </>
          ) : recommendation.status === 'insufficient_data' ? (
            <p className="text-small text-(--color-text)">
              {L.fitUnknown.replace('{measurements}', profileNames(recommendation.missing))}
            </p>
          ) : recommendation.status === 'no_matching_size' ? (
            <p className="text-small text-(--color-text)">
              {t.sizing.noMatch[recommendation.direction]}
            </p>
          ) : null}
          {recommendation.status === 'recommended' ||
          recommendation.status === 'no_matching_size' ? (
            <ChoiceGroup
              id={`${id}-fit`}
              label={t.sizing.fitLabel}
              value={recommendation.fitPreference}
              onChange={chooseFit}
              options={FIT_ORDER.map((value) => ({ value, label: t.sizing.fitOptions[value] }))}
              direction={direction}
            />
          ) : null}
        </section>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            size="lg"
            className="flex-1 gap-2"
            disabled={!available || adding}
            onClick={() => void addToCart()}
          >
            <ShoppingBag aria-hidden="true" />
            {adding ? t.cart.updating : t.product.addToCart}
          </Button>
          <AdjustMeasurements locale={locale} data={data} t={t} />
        </div>
        {!available ? <Alert variant="warning">{L.unavailable}</Alert> : null}
        <p className="text-caption text-(--color-text-muted)">{L.privacy}</p>
      </div>
    </div>
  );
}

/** "Adjust measurements": saved through the profile's own action, then the
 * whole page is recomputed on the server. */
function AdjustMeasurements({
  locale,
  data,
  t,
}: {
  locale: Locale;
  data: Ready;
  t: Pick<Dictionary, 'fitting' | 'bodyProfile'>;
}) {
  const router = useRouter();
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState<Record<MeasurementKey, string>>(() => valuesOf(data));
  const bound = updateBodyMeasurementsAction.bind(null, locale);
  const [state, formAction, pending] = React.useActionState(bound, IDLE);
  const [handled, setHandled] = React.useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === 'saved') setOpen(false);
  }
  React.useEffect(() => {
    if (state.status === 'saved') {
      toast({ title: t.fitting.savedProfile, variant: 'success' });
      router.refresh();
    }
  }, [state, router, t.fitting.savedProfile]);

  const labels = t.bodyProfile;
  const errorFor = (key: MeasurementKey) => {
    const code = state.status === 'error' ? state.fieldErrors?.[key] : undefined;
    if (!code || code === 'unknown_field') return undefined;
    const { min, max, unit } = MEASUREMENT_BOUNDS[key];
    return labels.errors[code]
      .replace('{min}', String(min))
      .replace('{max}', String(max))
      .replace('{unit}', labels.units[unit]);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setValues(valuesOf(data));
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="lg" variant="outline" className="flex-1 gap-2">
          <Ruler aria-hidden="true" />
          {t.fitting.changeProfile}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.fitting.changeProfileTitle}</DialogTitle>
          <DialogDescription>{t.fitting.changeProfileDescription}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="expectedUpdatedAt" value={data.profile.updatedAt} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {MEASUREMENT_KEYS.map((key) => (
              <MeasurementField
                key={key}
                id={`${id}-${key}`}
                name={key}
                label={labels.measurements[key].label}
                help={labels.measurements[key].help}
                unit={labels.units[MEASUREMENT_BOUNDS[key].unit]}
                required={(REQUIRED_MEASUREMENTS as readonly string[]).includes(key)}
                requiredMark={labels.requiredMark}
                optionalMark={labels.optionalMark}
                value={values[key]}
                onChange={(value) => setValues((current) => ({ ...current, [key]: value }))}
                error={errorFor(key)}
              />
            ))}
          </div>
          {state.status === 'error' && state.formError ? (
            <Alert variant="error">
              {state.formError === 'stale'
                ? labels.errors.stale
                : state.formError === 'invalid'
                  ? labels.errors.summary
                  : state.formError === 'session_expired'
                    ? labels.errors.sessionExpired
                    : labels.errors.generic}
            </Alert>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href={`/${locale}/account/body-profile`}
              className="text-small text-(--color-primary) underline-offset-4 hover:underline"
            >
              {t.fitting.openFullProfile}
            </Link>
            <Button type="submit" disabled={pending}>
              {pending ? t.fitting.savingProfile : t.fitting.saveProfile}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function valuesOf(data: Ready): Record<MeasurementKey, string> {
  return Object.fromEntries(
    MEASUREMENT_KEYS.map((key) => {
      const value = data.profile.measurements[key];
      return [key, typeof value === 'number' ? String(value) : ''];
    }),
  ) as Record<MeasurementKey, string>;
}
