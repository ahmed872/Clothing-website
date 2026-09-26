'use client';

import { useId, useMemo, useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2, X } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { ConfirmationDialog } from '@/components/admin/confirmation-dialog';
import { SizeChartTable } from '@/components/commerce/size-chart-table';
import {
  deleteProductSizingAction,
  saveProductSizingAction,
  type SerializedProductSizing,
} from '@/lib/admin/sizing-actions';
import type { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import type { Locale } from '@/lib/i18n/locales';
// Dependency-free files of the module, shared with the server's validation
// so the editor offers exactly the columns and limits the server accepts.
import {
  GARMENT_MEASUREMENT_BOUNDS,
  GARMENT_TYPES,
  type GarmentMeasurementKey,
  type GarmentType,
} from '@/modules/sizing/garment-types';
import { chartMeasurementsFor, requiredChartMeasurementsFor } from '@/modules/sizing/sizing-rules';
import type { SizeChartErrorCode, SizeChartFieldErrors } from '@/modules/sizing/size-chart.schemas';

export type AdminSizingLabels = ReturnType<typeof getAdminDictionary>['sizing'];

export interface SizeOptionChoice {
  id: string;
  nameAr: string;
  nameEn: string;
  values: { id: string; valueAr: string; valueEn: string }[];
}

interface Row {
  optionValueId: string;
  values: Partial<Record<GarmentMeasurementKey, string>>;
}

interface EditorState {
  garmentType: GarmentType | '';
  sizeOptionId: string;
  rows: Row[];
}

function stateFrom(
  sizing: SerializedProductSizing | null,
  options: SizeOptionChoice[],
): EditorState {
  if (!sizing) {
    // A product's size option is almost always the one called "Size";
    // preselect it so the common case is one click fewer. The admin can
    // pick another before saving.
    const guess = options.find((option) => /size|مقاس/i.test(`${option.nameEn} ${option.nameAr}`));
    return { garmentType: '', sizeOptionId: guess?.id ?? '', rows: [] };
  }
  return {
    garmentType: sizing.garmentType,
    sizeOptionId: sizing.sizeOption?.id ?? '',
    rows: sizing.entries.map((entry) => ({
      optionValueId: entry.optionValueId,
      values: Object.fromEntries(
        Object.entries(entry.measurements).map(([key, value]) => [key, String(value)]),
      ),
    })),
  };
}

/**
 * The product's garment type and size chart, edited as a whole and saved
 * in one action (clothing P02). Every check that matters — bounds, required
 * columns, duplicate sizes, and that each size really is this product's —
 * is the server's; the editor only shows what comes back, next to the cell
 * it belongs to.
 */
export function SizeChartEditor({
  productId,
  locale,
  sizing,
  sizeOptions,
  labels,
}: {
  productId: string;
  locale: Locale;
  sizing: SerializedProductSizing | null;
  sizeOptions: SizeOptionChoice[];
  labels: AdminSizingLabels;
}) {
  const id = useId();
  const [state, setState] = useState<EditorState>(() => stateFrom(sizing, sizeOptions));
  const [saved, setSaved] = useState<EditorState>(() => stateFrom(sizing, sizeOptions));
  const [version, setVersion] = useState<string | null>(sizing?.updatedAt ?? null);
  const [errors, setErrors] = useState<SizeChartFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [toAdd, setToAdd] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, startTransition] = useTransition();

  const option = sizeOptions.find((o) => o.id === state.sizeOptionId);
  const valueLabel = (valueId: string) => {
    const value = option?.values.find((v) => v.id === valueId);
    return value ? (locale === 'ar' ? value.valueAr : value.valueEn) : '—';
  };
  const columns = state.garmentType ? chartMeasurementsFor(state.garmentType) : [];
  const required = new Set(
    state.garmentType ? requiredChartMeasurementsFor(state.garmentType) : [],
  );
  const remaining = (option?.values ?? []).filter(
    (value) => !state.rows.some((row) => row.optionValueId === value.id),
  );
  const dirty = useMemo(() => JSON.stringify(state) !== JSON.stringify(saved), [state, saved]);

  const errorText = (code: SizeChartErrorCode | undefined, key?: GarmentMeasurementKey) => {
    if (!code) return undefined;
    const template = labels.fieldErrors[code];
    if (!key) return template;
    const { min, max } = GARMENT_MEASUREMENT_BOUNDS[key];
    return template.replace('{min}', String(min)).replace('{max}', String(max));
  };

  const update = (next: (current: EditorState) => EditorState) => {
    setState(next);
    setFormError(null);
  };

  const changeGarment = (garmentType: GarmentType) =>
    update((current) => {
      // Columns the new garment cannot hold are dropped rather than kept
      // invisibly — the server would refuse them.
      const allowed = new Set<string>(chartMeasurementsFor(garmentType));
      return {
        ...current,
        garmentType,
        rows: current.rows.map((row) => ({
          ...row,
          values: Object.fromEntries(
            Object.entries(row.values).filter(([key]) => allowed.has(key)),
          ),
        })),
      };
    });

  const changeSizeOption = (sizeOptionId: string) =>
    // Another option's values are other sizes entirely: the rows go.
    update((current) => ({ ...current, sizeOptionId, rows: [] }));

  const addRows = (valueIds: string[]) =>
    update((current) => ({
      ...current,
      rows: [...current.rows, ...valueIds.map((optionValueId) => ({ optionValueId, values: {} }))],
    }));

  const move = (index: number, by: -1 | 1) =>
    update((current) => {
      const rows = [...current.rows];
      const [row] = rows.splice(index, 1);
      rows.splice(index + by, 0, row!);
      return { ...current, rows };
    });

  const removeRow = (index: number) =>
    update((current) => ({ ...current, rows: current.rows.filter((_, i) => i !== index) }));

  const setCell = (index: number, key: GarmentMeasurementKey, raw: string) => {
    update((current) => ({
      ...current,
      rows: current.rows.map((row, i) =>
        i === index ? { ...row, values: { ...row.values, [key]: raw } } : row,
      ),
    }));
    setErrors((current) => {
      const cell = current.entries?.[index]?.[key];
      if (!cell) return current;
      const entries = {
        ...current.entries,
        [index]: { ...current.entries![index], [key]: undefined },
      };
      return { ...current, entries };
    });
  };

  const save = () =>
    startTransition(async () => {
      const result = await saveProductSizingAction(
        productId,
        {
          garmentType: state.garmentType as GarmentType,
          sizeOptionId: state.sizeOptionId || null,
          entries: state.rows.map((row) => ({
            optionValueId: row.optionValueId,
            measurements: Object.fromEntries(
              Object.entries(row.values).filter(([, value]) => value && value.trim() !== ''),
            ),
          })),
        },
        version,
        locale,
      );
      if (!result.ok || !result.sizing) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.fieldErrors ? labels.summary : (result.error ?? labels.summary));
        toast({ title: result.error ?? labels.summary, variant: 'error' });
        return;
      }
      const next = stateFrom(result.sizing, sizeOptions);
      setState(next);
      setSaved(next);
      setVersion(result.sizing.updatedAt);
      setErrors({});
      setFormError(null);
      toast({ title: labels.saved, variant: 'success' });
    });

  const removeSizing = () =>
    startTransition(async () => {
      const result = await deleteProductSizingAction(productId, locale);
      setConfirmRemove(false);
      if (!result.ok) {
        toast({ title: result.error ?? labels.summary, variant: 'error' });
        return;
      }
      const next = stateFrom(null, sizeOptions);
      setState(next);
      setSaved(next);
      setVersion(null);
      setErrors({});
      toast({ title: labels.removed, variant: 'success' });
    });

  const garmentId = `${id}-garment`;
  const optionId = `${id}-option`;
  const addId = `${id}-add`;

  return (
    <div className="flex flex-col gap-5" data-testid="size-chart-editor">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={garmentId}>{labels.garmentType}</Label>
          <Select
            value={state.garmentType}
            onValueChange={(value) => changeGarment(value as GarmentType)}
          >
            <SelectTrigger
              id={garmentId}
              aria-invalid={errors.garmentType ? true : undefined}
              aria-describedby={`${garmentId}-help`}
            >
              <SelectValue placeholder={labels.garmentTypePlaceholder}>
                {state.garmentType ? labels.garmentTypes[state.garmentType] : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {GARMENT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {labels.garmentTypes[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id={`${garmentId}-help`} className="text-caption text-(--color-text-muted)">
            {errorText(errors.garmentType) ?? labels.garmentTypeHelp}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={optionId}>{labels.sizeOption}</Label>
          <Select
            value={state.sizeOptionId}
            onValueChange={changeSizeOption}
            disabled={sizeOptions.length === 0}
          >
            <SelectTrigger
              id={optionId}
              aria-invalid={errors.sizeOptionId ? true : undefined}
              aria-describedby={`${optionId}-help`}
            >
              <SelectValue placeholder={labels.sizeOptionPlaceholder}>
                {option ? (locale === 'ar' ? option.nameAr : option.nameEn) : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {sizeOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {locale === 'ar' ? o.nameAr : o.nameEn}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id={`${optionId}-help`} className="text-caption text-(--color-text-muted)">
            {errorText(errors.sizeOptionId) ?? labels.sizeOptionHelp}
          </p>
        </div>
      </div>

      {sizeOptions.length === 0 ? <Alert variant="info">{labels.noSizeOption}</Alert> : null}

      {state.garmentType && option ? (
        <div className="flex flex-col gap-3">
          <p className="text-small text-(--color-text-muted)">{labels.measurementsHelp}</p>
          {state.rows.length === 0 ? (
            <p className="text-small text-(--color-text-muted)">{labels.empty}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    scope="col"
                    className="sticky start-0 z-10 bg-(--color-surface-raised)"
                  >
                    {labels.colSize}
                  </TableHead>
                  {columns.map((key) => (
                    <TableHead key={key} scope="col" className="whitespace-nowrap">
                      {labels.measurements[key]}
                      {required.has(key) ? <span aria-hidden="true"> *</span> : null}
                      <span className="font-normal normal-case"> ({labels.unitCm})</span>
                    </TableHead>
                  ))}
                  <TableHead scope="col" className="text-end">
                    <span className="sr-only">{labels.colActions}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.rows.map((row, index) => {
                  const size = valueLabel(row.optionValueId);
                  const rowErrors = errors.entries?.[index];
                  return (
                    <TableRow key={row.optionValueId} data-size-row={size}>
                      <TableHead
                        scope="row"
                        className="sticky start-0 z-10 bg-(--color-surface) text-sm font-medium tracking-normal normal-case text-(--color-text)"
                      >
                        {size}
                        {rowErrors?.optionValueId ? (
                          <span className="block text-caption text-(--color-error)">
                            {errorText(rowErrors.optionValueId)}
                          </span>
                        ) : null}
                      </TableHead>
                      {columns.map((key) => {
                        const cellError = errorText(rowErrors?.[key], key);
                        const cellId = `${id}-${index}-${key}`;
                        return (
                          <TableCell key={key} className="min-w-22 align-top">
                            <Input
                              id={cellId}
                              inputMode="decimal"
                              dir="ltr"
                              autoComplete="off"
                              className="h-9 text-end tabular-nums"
                              value={row.values[key] ?? ''}
                              onChange={(event) => setCell(index, key, event.target.value)}
                              aria-label={labels.cellLabel
                                .replace('{measurement}', labels.measurements[key])
                                .replace('{size}', size)}
                              aria-required={required.has(key) || undefined}
                              aria-invalid={cellError ? true : undefined}
                              aria-describedby={cellError ? `${cellId}-error` : undefined}
                            />
                            {cellError ? (
                              <p
                                id={`${cellId}-error`}
                                className="mt-1 text-caption text-(--color-error)"
                              >
                                {cellError}
                              </p>
                            ) : null}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-end whitespace-nowrap">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                          aria-label={labels.moveUp.replace('{size}', size)}
                        >
                          <ArrowUp aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          disabled={index === state.rows.length - 1}
                          onClick={() => move(index, 1)}
                          aria-label={labels.moveDown.replace('{size}', size)}
                        >
                          <ArrowDown aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => removeRow(index)}
                          aria-label={labels.remove.replace('{size}', size)}
                        >
                          <X aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {remaining.length > 0 ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex flex-col gap-1.5 sm:w-56">
                <Label htmlFor={addId}>{labels.addSizeLabel}</Label>
                <Select value={toAdd} onValueChange={setToAdd}>
                  <SelectTrigger id={addId}>
                    <SelectValue placeholder="—">
                      {toAdd ? valueLabel(toAdd) : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {remaining.map((value) => (
                      <SelectItem key={value.id} value={value.id}>
                        {locale === 'ar' ? value.valueAr : value.valueEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={!toAdd}
                onClick={() => {
                  addRows([toAdd]);
                  setToAdd('');
                }}
              >
                <Plus aria-hidden="true" />
                {labels.addSize}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => addRows(remaining.map((value) => value.id))}
              >
                {labels.addAllSizes}
              </Button>
            </div>
          ) : (
            <p className="text-caption text-(--color-text-muted)">{labels.allSizesAdded}</p>
          )}
        </div>
      ) : null}

      {formError ? (
        <Alert variant="error" data-testid="size-chart-error">
          {formError}
        </Alert>
      ) : null}

      {showPreview && state.garmentType ? (
        <div className="flex flex-col gap-2" data-testid="size-chart-preview">
          <p className="text-sm font-medium text-(--color-text)">{labels.previewTitle}</p>
          {state.rows.length === 0 ? (
            <p className="text-small text-(--color-text-muted)">{labels.previewEmpty}</p>
          ) : (
            <SizeChartTable
              caption={labels.previewTitle}
              locale={locale}
              columns={columns.filter((key) =>
                state.rows.some((row) => (row.values[key] ?? '').trim() !== ''),
              )}
              rows={state.rows.map((row) => ({
                sizeId: row.optionValueId,
                label: valueLabel(row.optionValueId),
                measurements: Object.fromEntries(
                  Object.entries(row.values)
                    .map(([key, value]) => [key, Number((value ?? '').replace(',', '.'))])
                    .filter(([, value]) => Number.isFinite(value) && (value as number) > 0),
                ),
              }))}
              labels={{
                size: labels.colSize,
                unit: labels.unitCm,
                measurements: labels.measurements,
              }}
            />
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={save} disabled={pending || !state.garmentType}>
          {pending ? labels.saving : labels.save}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowPreview((v) => !v)}
          disabled={!state.garmentType}
          aria-pressed={showPreview}
        >
          {showPreview ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          {showPreview ? labels.hidePreview : labels.preview}
        </Button>
        {version ? (
          <Button
            type="button"
            variant="ghost"
            className="text-(--color-error)"
            onClick={() => setConfirmRemove(true)}
            disabled={pending}
          >
            <Trash2 aria-hidden="true" />
            {labels.removeSizing}
          </Button>
        ) : null}
        {dirty ? (
          <Badge variant="warning" data-testid="size-chart-unsaved">
            {labels.unsaved}
          </Badge>
        ) : null}
      </div>

      <ConfirmationDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={labels.removeSizing}
        description={labels.removeSizingConfirm}
        confirmLabel={labels.removeSizing}
        cancelLabel={locale === 'ar' ? 'إلغاء' : 'Cancel'}
        destructive
        loading={pending}
        onConfirm={removeSizing}
      />
    </div>
  );
}
