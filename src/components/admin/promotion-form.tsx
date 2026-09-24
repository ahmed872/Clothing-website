'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { fromMinor, toMinor } from '@/modules/core/money';
import { FormSection } from '@/components/admin/form-section';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createPromotionAction,
  updatePromotionAction,
  type PromotionFormInput,
} from '@/lib/admin/promotion-actions';
import { ScopePicker, type ScopeSelection } from '@/components/admin/scope-picker';
import type { ScopeOption } from '@/lib/admin/scope-search-actions';
import type { Locale } from '@/lib/i18n/locales';

export interface PromotionFormLabels {
  sectionBasics: string;
  sectionRules: string;
  sectionScope: string;
  sectionLimits: string;
  code: string;
  codeHelp: string;
  type: string;
  typePercentage: string;
  typeFixed: string;
  valuePercent: string;
  valueFixed: string;
  descriptionAr: string;
  descriptionEn: string;
  minOrder: string;
  minOrderHelp: string;
  maxDiscount: string;
  maxDiscountHelp: string;
  usageLimit: string;
  usageLimitHelp: string;
  perCustomerLimit: string;
  perCustomerLimitHelp: string;
  startsAt: string;
  endsAt: string;
  active: string;
  activeHelp: string;
  scopeHelp: string;
  scopeProducts: string;
  scopeCategories: string;
  scopeBrands: string;
  scopeSearchPlaceholder: string;
  scopeSearching: string;
  scopeNoResults: string;
  scopeAdd: string;
  scopeRemove: string;
  scopeSelected: string;
  scopeEmpty: string;
  save: string;
  saving: string;
  cancel: string;
  createdSuccess: string;
  updatedSuccess: string;
}

export interface PromotionFormValues {
  id: string | null;
  code: string;
  type: 'PERCENTAGE' | 'FIXED';
  /** Percent points for PERCENTAGE, minor units for FIXED. */
  value: number;
  descriptionAr: string;
  descriptionEn: string;
  minOrderMinor: number | null;
  maxDiscountMinor: number | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  startsAt: string;
  endsAt: string;
  active: boolean;
  scopes: ScopeSelection[];
  updatedAt: string | null;
}

/** A `<input type="date">` needs `YYYY-MM-DD`; an ISO timestamp is not it. */
function toDateInput(value: string): string {
  return value ? value.slice(0, 10) : '';
}

export function PromotionForm({
  initial,
  locale,
  labels,
  categories,
  brands,
}: {
  initial: PromotionFormValues;
  locale: Locale;
  labels: PromotionFormLabels;
  categories: ScopeOption[];
  brands: ScopeOption[];
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPercentage = values.type === 'PERCENTAGE';

  function set<K extends keyof PromotionFormValues>(key: K, value: PromotionFormValues[K]): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  /** Money is typed in major units and stored in minor ones — the same
   * conversion every other admin money field makes. */
  function moneyField(value: number | null): string {
    return value === null ? '' : String(fromMinor(value));
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const payload: PromotionFormInput = {
      code: values.code,
      type: values.type,
      value: values.value,
      descriptionAr: values.descriptionAr.trim() || null,
      descriptionEn: values.descriptionEn.trim() || null,
      minOrderMinor: values.minOrderMinor,
      // A ceiling only means something for a percentage; the domain rejects
      // it on a fixed amount, so it is not sent for one.
      maxDiscountMinor: isPercentage ? values.maxDiscountMinor : null,
      usageLimit: values.usageLimit,
      perCustomerLimit: values.perCustomerLimit,
      startsAt: values.startsAt || null,
      endsAt: values.endsAt || null,
      active: values.active,
      scopes: values.scopes.map((scope) => ({
        scopeType: scope.scopeType,
        targetId: scope.targetId,
      })),
    };

    const result = values.id
      ? await updatePromotionAction(values.id, payload, values.updatedAt, locale)
      : await createPromotionAction(payload, locale);

    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? null);
      return;
    }

    toast({
      title: values.id ? labels.updatedSuccess : labels.createdSuccess,
      variant: 'success',
    });
    router.push('/admin/promotions');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      {error ? (
        <Alert variant="error" role="alert">
          {error}
        </Alert>
      ) : null}

      <FormSection title={labels.sectionBasics}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="promo-code">{labels.code}</Label>
            <Input
              id="promo-code"
              dir="ltr"
              required
              value={values.code}
              onChange={(event) => set('code', event.target.value)}
              aria-describedby="promo-code-help"
              className="tabular-nums"
            />
            <p id="promo-code-help" className="text-caption text-(--color-text-muted)">
              {labels.codeHelp}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="promo-type">{labels.type}</Label>
            <Select
              value={values.type}
              onValueChange={(next) => set('type', next as 'PERCENTAGE' | 'FIXED')}
            >
              <SelectTrigger id="promo-type">
                <SelectValue>{isPercentage ? labels.typePercentage : labels.typeFixed}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PERCENTAGE">{labels.typePercentage}</SelectItem>
                <SelectItem value="FIXED">{labels.typeFixed}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="promo-value">
              {isPercentage ? labels.valuePercent : labels.valueFixed}
            </Label>
            <Input
              id="promo-value"
              type="number"
              min={1}
              max={isPercentage ? 100 : undefined}
              step={isPercentage ? 1 : '0.01'}
              dir="ltr"
              required
              value={isPercentage ? values.value : fromMinor(values.value)}
              onChange={(event) =>
                set(
                  'value',
                  isPercentage
                    ? Math.trunc(Number(event.target.value) || 0)
                    : toMinor(Number(event.target.value) || 0),
                )
              }
              className="tabular-nums"
            />
          </div>

          <div className="flex items-start justify-between gap-4 sm:col-span-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="promo-active">{labels.active}</Label>
              <p className="text-caption text-(--color-text-muted)">{labels.activeHelp}</p>
            </div>
            <Switch
              id="promo-active"
              checked={values.active}
              onCheckedChange={(next) => set('active', next)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="promo-desc-ar">{labels.descriptionAr}</Label>
            <Textarea
              id="promo-desc-ar"
              rows={2}
              value={values.descriptionAr}
              onChange={(event) => set('descriptionAr', event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="promo-desc-en">{labels.descriptionEn}</Label>
            <Textarea
              id="promo-desc-en"
              rows={2}
              value={values.descriptionEn}
              onChange={(event) => set('descriptionEn', event.target.value)}
            />
          </div>
        </div>
      </FormSection>

      <FormSection title={labels.sectionRules}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="promo-min">{labels.minOrder}</Label>
            <Input
              id="promo-min"
              type="number"
              min={0}
              step="0.01"
              dir="ltr"
              value={moneyField(values.minOrderMinor)}
              onChange={(event) =>
                set(
                  'minOrderMinor',
                  event.target.value === '' ? null : toMinor(Number(event.target.value)),
                )
              }
              aria-describedby="promo-min-help"
              className="tabular-nums"
            />
            <p id="promo-min-help" className="text-caption text-(--color-text-muted)">
              {labels.minOrderHelp}
            </p>
          </div>

          {isPercentage ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="promo-max">{labels.maxDiscount}</Label>
              <Input
                id="promo-max"
                type="number"
                min={0}
                step="0.01"
                dir="ltr"
                value={moneyField(values.maxDiscountMinor)}
                onChange={(event) =>
                  set(
                    'maxDiscountMinor',
                    event.target.value === '' ? null : toMinor(Number(event.target.value)),
                  )
                }
                aria-describedby="promo-max-help"
                className="tabular-nums"
              />
              <p id="promo-max-help" className="text-caption text-(--color-text-muted)">
                {labels.maxDiscountHelp}
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="promo-starts">{labels.startsAt}</Label>
            <Input
              id="promo-starts"
              type="date"
              dir="ltr"
              value={toDateInput(values.startsAt)}
              onChange={(event) => set('startsAt', event.target.value)}
              className="tabular-nums"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="promo-ends">{labels.endsAt}</Label>
            <Input
              id="promo-ends"
              type="date"
              dir="ltr"
              value={toDateInput(values.endsAt)}
              onChange={(event) => set('endsAt', event.target.value)}
              className="tabular-nums"
            />
          </div>
        </div>
      </FormSection>

      <FormSection title={labels.sectionLimits}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="promo-usage">{labels.usageLimit}</Label>
            <Input
              id="promo-usage"
              type="number"
              min={1}
              step="1"
              dir="ltr"
              value={values.usageLimit ?? ''}
              onChange={(event) =>
                set('usageLimit', event.target.value === '' ? null : Number(event.target.value))
              }
              aria-describedby="promo-usage-help"
              className="tabular-nums"
            />
            <p id="promo-usage-help" className="text-caption text-(--color-text-muted)">
              {labels.usageLimitHelp}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="promo-per-customer">{labels.perCustomerLimit}</Label>
            <Input
              id="promo-per-customer"
              type="number"
              min={1}
              step="1"
              dir="ltr"
              value={values.perCustomerLimit ?? ''}
              onChange={(event) =>
                set(
                  'perCustomerLimit',
                  event.target.value === '' ? null : Number(event.target.value),
                )
              }
              aria-describedby="promo-per-customer-help"
              className="tabular-nums"
            />
            <p id="promo-per-customer-help" className="text-caption text-(--color-text-muted)">
              {labels.perCustomerLimitHelp}
            </p>
          </div>
        </div>
      </FormSection>

      <FormSection title={labels.sectionScope} description={labels.scopeHelp}>
        <ScopePicker
          value={values.scopes}
          onChange={(scopes) => set('scopes', scopes)}
          locale={locale}
          categories={categories}
          brands={brands}
          labels={labels}
        />
      </FormSection>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.push('/admin/promotions')}>
          {labels.cancel}
        </Button>
        <Button type="submit" loading={busy} disabled={busy}>
          {busy ? labels.saving : labels.save}
        </Button>
      </div>
    </form>
  );
}
