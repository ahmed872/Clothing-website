'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus, Trash2, X, Wand2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { toast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmationDialog } from '@/components/admin/confirmation-dialog';
import {
  createProductOptionAction,
  addOptionValuesAction,
  deleteProductOptionAction,
  deleteOptionValueAction,
  generateVariantsAction,
  updateVariantAction,
  deleteVariantAction,
} from '@/lib/admin/variant-actions';
import { toMinor, fromMinor } from '@/modules/core/money';
import type { Locale } from '@/lib/i18n/locales';

export interface OptionValueRow {
  id: string;
  valueAr: string;
  valueEn: string;
}

export interface ProductOptionRow {
  id: string;
  nameAr: string;
  nameEn: string;
  values: OptionValueRow[];
}

export interface VariantRow {
  id: string;
  sku: string;
  /** Pre-composed server-side from the variant's option values, e.g.
   * "Black / 41" — the client has no need to resolve the join itself. */
  label: string;
  priceMinor: number;
  compareAtMinor: number | null;
  stockQuantity: number;
  trackInventory: boolean;
  weightGrams: number | null;
  updatedAt: string;
}

export interface VariantBuilderLabels {
  optionsTitle: string;
  newOption: string;
  optionNameAr: string;
  optionNameEn: string;
  optionValues: string;
  optionValuesHelp: string;
  addValue: string;
  deleteOption: string;
  deleteValue: string;
  optionsEmpty: string;
  generate: string;
  generating: string;
  generatedCount: string;
  generatedNone: string;
  variantsTitle: string;
  variantsCount: string;
  colVariant: string;
  colSku: string;
  colPrice: string;
  colCompareAt: string;
  colStock: string;
  colWeight: string;
  stockReadOnlyHelp: string;
  manageStock: string;
  notTracked: string;
  defaultVariant: string;
  saveVariant: string;
  deleteVariant: string;
  deleteVariantConfirm: string;
  variantSaved: string;
  variantsEmpty: string;
  confirmDeleteTitle: string;
  cancel: string;
  confirm: string;
  save: string;
  saving: string;
  deletedSuccessfully: string;
  requiredField: string;
}

/**
 * P07 §7's variant builder: define options and their values, press
 * "Generate combinations", edit each resulting variant in place.
 *
 * Every rule it appears to enforce is actually enforced server-side — a
 * duplicate SKU, a duplicate combination, an option still in use, the last
 * variant of a published product. This component's job is to make the
 * server's answer visible next to the row that caused it, not to
 * pre-judge it.
 */
export function VariantBuilder({
  productId,
  locale,
  options,
  variants,
  labels,
}: {
  productId: string;
  locale: Locale;
  options: ProductOptionRow[];
  variants: VariantRow[];
  labels: VariantBuilderLabels;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creatingOption, setCreatingOption] = useState(false);
  const [deletingVariantId, setDeletingVariantId] = useState<string | null>(null);

  async function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    successText: string,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? null);
      return false;
    }
    toast({ title: successText, variant: 'success' });
    router.refresh();
    return true;
  }

  async function generate(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await generateVariantsAction(productId, locale);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? null);
      return;
    }
    const created = result.data?.created ?? 0;
    toast({
      title:
        created > 0
          ? labels.generatedCount.replace('{count}', String(created))
          : labels.generatedNone,
      variant: 'success',
    });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <Alert variant="error" role="alert">
          {error}
        </Alert>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-h6 text-(--color-text)">{labels.optionsTitle}</h3>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setCreatingOption(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {labels.newOption}
            </Button>
            <Button type="button" onClick={() => void generate()} disabled={busy}>
              <Wand2 className="size-4" aria-hidden="true" />
              {busy ? labels.generating : labels.generate}
            </Button>
          </div>
        </div>

        {options.length === 0 ? (
          <p className="text-small text-(--color-text-muted)">{labels.optionsEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {options.map((option) => (
              <OptionRow
                key={option.id}
                option={option}
                productId={productId}
                locale={locale}
                busy={busy}
                labels={labels}
                run={run}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-h6 text-(--color-text)">{labels.variantsTitle}</h3>
          <p className="text-small text-(--color-text-muted)">
            {labels.variantsCount.replace('{count}', String(variants.length))}
          </p>
        </div>

        {variants.length > 0 ? (
          <p className="text-small text-(--color-text-muted)">
            {labels.stockReadOnlyHelp}{' '}
            <Link
              href={`/admin/inventory?productId=${productId}`}
              className="text-(--color-primary) underline underline-offset-2"
            >
              {labels.manageStock}
            </Link>
          </p>
        ) : null}

        {variants.length === 0 ? (
          <p className="text-small text-(--color-text-muted)">{labels.variantsEmpty}</p>
        ) : (
          <div className="w-full overflow-x-auto rounded-(--radius-surface) border border-(--color-border)">
            <table className="w-full min-w-3xl border-collapse text-sm">
              <thead>
                <tr className="border-b border-(--color-border) bg-(--color-surface-raised) text-start">
                  <th className="p-3 text-start font-medium">{labels.colVariant}</th>
                  <th className="p-3 text-start font-medium">{labels.colSku}</th>
                  <th className="p-3 text-start font-medium">{labels.colPrice}</th>
                  <th className="p-3 text-start font-medium">{labels.colCompareAt}</th>
                  <th className="p-3 text-start font-medium">{labels.colStock}</th>
                  <th className="p-3 text-start font-medium">{labels.colWeight}</th>
                  <th className="p-3 text-end font-medium">{labels.saveVariant}</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((variant) => (
                  <VariantEditorRow
                    key={variant.id}
                    variant={variant}
                    productId={productId}
                    locale={locale}
                    busy={busy}
                    labels={labels}
                    run={run}
                    onRequestDelete={() => setDeletingVariantId(variant.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <NewOptionDialog
        open={creatingOption}
        onOpenChange={setCreatingOption}
        productId={productId}
        locale={locale}
        labels={labels}
        run={run}
      />

      <ConfirmationDialog
        open={Boolean(deletingVariantId)}
        onOpenChange={(open) => !open && setDeletingVariantId(null)}
        title={labels.confirmDeleteTitle}
        description={error ?? labels.deleteVariantConfirm}
        confirmLabel={labels.confirm}
        cancelLabel={labels.cancel}
        destructive
        loading={busy}
        onConfirm={async () => {
          if (!deletingVariantId) return;
          const ok = await run(
            () => deleteVariantAction(deletingVariantId, productId, locale),
            labels.deletedSuccessfully,
          );
          if (ok) setDeletingVariantId(null);
        }}
      />
    </div>
  );
}

function OptionRow({
  option,
  productId,
  locale,
  busy,
  labels,
  run,
}: {
  option: ProductOptionRow;
  productId: string;
  locale: Locale;
  busy: boolean;
  labels: VariantBuilderLabels;
  run: (action: () => Promise<{ ok: boolean; error?: string }>, text: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState('');

  function addValue(): void {
    const value = draft.trim();
    if (!value) return;
    setDraft('');
    void run(
      () =>
        addOptionValuesAction(option.id, productId, [{ valueAr: value, valueEn: value }], locale),
      labels.save,
    );
  }

  return (
    <li className="flex flex-col gap-2 rounded-(--radius-panel) border border-(--color-border) bg-(--color-surface) p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-(--color-text)">
          {locale === 'ar' ? option.nameAr : option.nameEn}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={busy}
          aria-label={labels.deleteOption}
          onClick={() =>
            void run(
              () => deleteProductOptionAction(option.id, productId, locale),
              labels.deletedSuccessfully,
            )
          }
        >
          <Trash2 className="size-4 text-(--color-error)" aria-hidden="true" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {option.values.map((value) => (
          <Badge key={value.id} variant="neutral" className="gap-1">
            {locale === 'ar' ? value.valueAr : value.valueEn}
            <button
              type="button"
              disabled={busy}
              aria-label={`${labels.deleteValue}: ${value.valueEn}`}
              onClick={() =>
                void run(
                  () => deleteOptionValueAction(value.id, productId, locale),
                  labels.deletedSuccessfully,
                )
              }
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </Badge>
        ))}
      </div>

      <div className="flex max-w-sm items-center gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addValue();
            }
          }}
          aria-label={`${labels.optionValues}: ${option.nameEn}`}
          disabled={busy}
        />
        <Button type="button" variant="outline" onClick={addValue} disabled={busy}>
          {labels.addValue}
        </Button>
      </div>
    </li>
  );
}

function VariantEditorRow({
  variant,
  productId,
  locale,
  busy,
  labels,
  run,
  onRequestDelete,
}: {
  variant: VariantRow;
  productId: string;
  locale: Locale;
  busy: boolean;
  labels: VariantBuilderLabels;
  run: (action: () => Promise<{ ok: boolean; error?: string }>, text: string) => Promise<boolean>;
  onRequestDelete: () => void;
}) {
  const [sku, setSku] = useState(variant.sku);
  const [price, setPrice] = useState(String(fromMinor(variant.priceMinor)));
  const [compareAt, setCompareAt] = useState(
    variant.compareAtMinor === null ? '' : String(fromMinor(variant.compareAtMinor)),
  );
  const [weight, setWeight] = useState(
    variant.weightGrams === null ? '' : String(variant.weightGrams),
  );

  function save(): void {
    void run(
      () =>
        updateVariantAction(
          variant.id,
          productId,
          {
            sku,
            priceMinor: toMinor(Number(price) || 0),
            compareAtMinor: compareAt === '' ? null : toMinor(Number(compareAt)),
            weightGrams: weight === '' ? null : Number(weight),
          },
          variant.updatedAt,
          locale,
        ),
      labels.variantSaved,
    );
  }

  const label = variant.label || labels.defaultVariant;

  return (
    <tr className="border-b border-(--color-border) last:border-b-0">
      <td className="p-3 font-medium whitespace-nowrap">{label}</td>
      <td className="p-3">
        <Input
          value={sku}
          onChange={(event) => setSku(event.target.value)}
          aria-label={`${labels.colSku}: ${label}`}
          className="w-40 tabular-nums"
          dir="ltr"
        />
      </td>
      <td className="p-3">
        <Input
          type="number"
          min={0}
          step="0.01"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          aria-label={`${labels.colPrice}: ${label}`}
          className="w-28 tabular-nums"
        />
      </td>
      <td className="p-3">
        <Input
          type="number"
          min={0}
          step="0.01"
          value={compareAt}
          onChange={(event) => setCompareAt(event.target.value)}
          aria-label={`${labels.colCompareAt}: ${label}`}
          className="w-28 tabular-nums"
        />
      </td>
      {/* Read-only on purpose: stock only ever moves through the inventory
          service, which records why and by whom (P08 §2). Editing it in a
          form that also saves a SKU would be a silent, unexplained write. */}
      <td className="p-3 whitespace-nowrap">
        {variant.trackInventory ? (
          <span className="tabular-nums" dir="ltr">
            {variant.stockQuantity}
          </span>
        ) : (
          <span className="text-(--color-text-muted)">{labels.notTracked}</span>
        )}
      </td>
      <td className="p-3">
        <Input
          type="number"
          min={0}
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          aria-label={`${labels.colWeight}: ${label}`}
          className="w-24 tabular-nums"
        />
      </td>
      <td className="p-3">
        <div className="flex items-center justify-end gap-1">
          <Button type="button" size="sm" onClick={save} disabled={busy}>
            {labels.saveVariant}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={`${labels.deleteVariant}: ${label}`}
            onClick={onRequestDelete}
          >
            <Trash2 className="size-4 text-(--color-error)" aria-hidden="true" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function NewOptionDialog({
  open,
  onOpenChange,
  productId,
  locale,
  labels,
  run,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  locale: Locale;
  labels: VariantBuilderLabels;
  run: (action: () => Promise<{ ok: boolean; error?: string }>, text: string) => Promise<boolean>;
}) {
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [values, setValues] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function addValue(): void {
    const value = draft.trim();
    if (!value || values.includes(value)) return;
    setValues([...values, value]);
    setDraft('');
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!nameEn.trim() || !nameAr.trim() || values.length === 0) return;
    setSubmitting(true);
    const ok = await run(
      () =>
        createProductOptionAction(
          productId,
          {
            nameAr: nameAr.trim(),
            nameEn: nameEn.trim(),
            // One typed value fills both locales: the admin types "Black"
            // once, and can translate it afterwards rather than being
            // forced to enter every value twice up front.
            values: values.map((value) => ({ valueAr: value, valueEn: value })),
          },
          locale,
        ),
      labels.save,
    );
    setSubmitting(false);
    if (ok) {
      setNameEn('');
      setNameAr('');
      setValues([]);
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.newOption}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="option-name-en">{labels.optionNameEn}</Label>
            <Input
              id="option-name-en"
              value={nameEn}
              onChange={(event) => setNameEn(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="option-name-ar">{labels.optionNameAr}</Label>
            <Input
              id="option-name-ar"
              dir="rtl"
              value={nameAr}
              onChange={(event) => setNameAr(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="option-values">{labels.optionValues}</Label>
            <div className="flex gap-2">
              <Input
                id="option-values"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addValue();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addValue}>
                {labels.addValue}
              </Button>
            </div>
            <p className="text-caption text-(--color-text-muted)">{labels.optionValuesHelp}</p>
            {values.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {values.map((value) => (
                  <Badge key={value} variant="neutral" className="gap-1">
                    {value}
                    <button
                      type="button"
                      aria-label={`${labels.deleteValue}: ${value}`}
                      onClick={() => setValues(values.filter((v) => v !== value))}
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {labels.cancel}
            </Button>
            <Button type="submit" loading={submitting} disabled={submitting}>
              {submitting ? labels.saving : labels.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
