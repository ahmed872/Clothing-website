'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmationDialog } from '@/components/admin/confirmation-dialog';
import {
  createAttributeDefinitionAction,
  updateAttributeDefinitionAction,
  deleteAttributeDefinitionAction,
} from '@/lib/admin/attribute-actions';
import type { Locale } from '@/lib/i18n/locales';

const ATTRIBUTE_TYPES = ['TEXT', 'NUMBER', 'BOOLEAN', 'SELECT', 'MULTI_SELECT'] as const;
type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

const attributeFormSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/),
    labelAr: z.string().min(1),
    labelEn: z.string().min(1),
    type: z.enum(ATTRIBUTE_TYPES),
    unit: z.string().nullable(),
    allowedValues: z.array(z.string().min(1)),
    required: z.boolean(),
    filterable: z.boolean(),
  })
  .superRefine((value, ctx) => {
    const needsAllowedValues = value.type === 'SELECT' || value.type === 'MULTI_SELECT';
    if (needsAllowedValues && value.allowedValues.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowedValues'],
        message: 'required',
      });
    }
  });
type AttributeFormValues = z.infer<typeof attributeFormSchema>;

export interface AttributeDefinitionRow {
  id: string;
  key: string;
  labelAr: string;
  labelEn: string;
  type: AttributeType;
  unit: string | null;
  allowedValues: string[] | null;
  required: boolean;
  filterable: boolean;
  /** From an ancestor category, not this one — shown read-only: editing it
   * here would silently edit the ancestor's own definition. */
  inherited: boolean;
}

export interface AttributeDefinitionsManagerLabels {
  title: string;
  description: string;
  newAttribute: string;
  emptyTitle: string;
  emptyDescription: string;
  key: string;
  keyHelp: string;
  labelAr: string;
  labelEn: string;
  type: string;
  typeText: string;
  typeNumber: string;
  typeBoolean: string;
  typeSelect: string;
  typeMultiSelect: string;
  unit: string;
  allowedValues: string;
  allowedValuesHelp: string;
  addValue: string;
  required: string;
  filterable: string;
  inherited: string;
  deleteConfirmDescription: string;
  save: string;
  saving: string;
  cancel: string;
  edit: string;
  delete: string;
  confirmDeleteTitle: string;
  confirm: string;
  deletedSuccessfully: string;
  savedSuccessfully: string;
  requiredField: string;
}

export function AttributeDefinitionsManager({
  categoryId,
  locale,
  labels,
  definitions,
}: {
  categoryId: string;
  locale: Locale;
  labels: AttributeDefinitionsManagerLabels;
  definitions: AttributeDefinitionRow[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<AttributeDefinitionRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const typeLabel = (type: AttributeType) =>
    ({
      TEXT: labels.typeText,
      NUMBER: labels.typeNumber,
      BOOLEAN: labels.typeBoolean,
      SELECT: labels.typeSelect,
      MULTI_SELECT: labels.typeMultiSelect,
    })[type];

  async function handleDelete() {
    if (!deletingId) return;
    setDeleting(true);
    setDeleteError(null);
    const result = await deleteAttributeDefinitionAction(deletingId, categoryId, locale);
    setDeleting(false);
    if (!result.ok) {
      setDeleteError(result.error ?? null);
      return;
    }
    setDeletingId(null);
    toast({ title: labels.deletedSuccessfully, variant: 'success' });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-h4 text-(--color-text)">{labels.title}</h2>
          <p className="text-small text-(--color-text-muted)">{labels.description}</p>
        </div>
        <Button type="button" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden="true" />
          {labels.newAttribute}
        </Button>
      </div>

      {definitions.length === 0 ? (
        <EmptyState title={labels.emptyTitle} description={labels.emptyDescription} />
      ) : (
        <ul className="flex flex-col gap-2">
          {definitions.map((definition) => (
            <li
              key={definition.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-panel) border border-(--color-border) bg-(--color-surface) p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-(--color-text)">
                  {locale === 'ar' ? definition.labelAr : definition.labelEn}
                </span>
                <span className="text-caption text-(--color-text-muted) tabular-nums">
                  {definition.key}
                </span>
                <Badge variant="info">{typeLabel(definition.type)}</Badge>
                {definition.required ? <Badge variant="warning">{labels.required}</Badge> : null}
                {definition.filterable ? (
                  <Badge variant="neutral">{labels.filterable}</Badge>
                ) : null}
                {definition.inherited ? <Badge variant="outline">{labels.inherited}</Badge> : null}
              </div>
              {definition.inherited ? null : (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={labels.edit}
                    onClick={() => setEditing(definition)}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={labels.delete}
                    onClick={() => {
                      setDeletingId(definition.id);
                      setDeleteError(null);
                    }}
                  >
                    <Trash2 className="size-4 text-(--color-error)" aria-hidden="true" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <AttributeFormDialog
        open={creating}
        onOpenChange={setCreating}
        categoryId={categoryId}
        locale={locale}
        labels={labels}
        onSaved={() => {
          setCreating(false);
          router.refresh();
        }}
      />
      <AttributeFormDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        categoryId={categoryId}
        locale={locale}
        labels={labels}
        definition={editing ?? undefined}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />

      <ConfirmationDialog
        open={Boolean(deletingId)}
        onOpenChange={(open) => !open && setDeletingId(null)}
        title={labels.confirmDeleteTitle}
        description={deleteError ?? labels.deleteConfirmDescription}
        confirmLabel={labels.confirm}
        cancelLabel={labels.cancel}
        onConfirm={handleDelete}
        destructive
        loading={deleting}
      />
    </div>
  );
}

function AttributeFormDialog({
  open,
  onOpenChange,
  categoryId,
  locale,
  labels,
  definition,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryId: string;
  locale: Locale;
  labels: AttributeDefinitionsManagerLabels;
  definition?: AttributeDefinitionRow;
  onSaved: () => void;
}) {
  const isEdit = Boolean(definition);
  const [formError, setFormError] = useState<string | null>(null);
  const [valueDraft, setValueDraft] = useState('');

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AttributeFormValues>({
    resolver: zodResolver(attributeFormSchema),
    values: {
      key: definition?.key ?? '',
      labelAr: definition?.labelAr ?? '',
      labelEn: definition?.labelEn ?? '',
      type: definition?.type ?? 'TEXT',
      unit: definition?.unit ?? null,
      allowedValues: definition?.allowedValues ?? [],
      required: definition?.required ?? false,
      filterable: definition?.filterable ?? false,
    },
  });

  const type = useWatch({ control, name: 'type' });
  const needsAllowedValues = type === 'SELECT' || type === 'MULTI_SELECT';

  async function onSubmit(values: AttributeFormValues) {
    setFormError(null);
    const payload = {
      ...values,
      unit: values.unit || null,
      allowedValues: needsAllowedValues ? values.allowedValues : null,
    };

    const result = definition
      ? await updateAttributeDefinitionAction(
          definition.id,
          categoryId,
          {
            labelAr: payload.labelAr,
            labelEn: payload.labelEn,
            type: payload.type,
            unit: payload.unit,
            allowedValues: payload.allowedValues,
            required: payload.required,
            filterable: payload.filterable,
          },
          locale,
        )
      : await createAttributeDefinitionAction({ categoryId, ...payload }, locale);

    if (!result.ok) {
      setFormError(result.error ?? 'Error');
      return;
    }

    toast({ title: labels.savedSuccessfully, variant: 'success' });
    reset();
    setValueDraft('');
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? labels.edit : labels.newAttribute}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {formError ? (
            <Alert variant="error" role="alert">
              {formError}
            </Alert>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="attr-key">{labels.key}</Label>
            <Input
              id="attr-key"
              dir="ltr"
              disabled={isEdit}
              {...register('key')}
              aria-invalid={errors.key ? true : undefined}
            />
            <p className="text-caption text-(--color-text-muted)">{labels.keyHelp}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="attr-label-en">{labels.labelEn}</Label>
            <Input
              id="attr-label-en"
              {...register('labelEn')}
              aria-invalid={errors.labelEn ? true : undefined}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="attr-label-ar">{labels.labelAr}</Label>
            <Input
              id="attr-label-ar"
              dir="rtl"
              {...register('labelAr')}
              aria-invalid={errors.labelAr ? true : undefined}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="attr-type">{labels.type}</Label>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={isEdit}>
                  <SelectTrigger id="attr-type">
                    <SelectValue>{typeLabelFor(field.value, labels)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ATTRIBUTE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {typeLabelFor(t, labels)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="attr-unit">{labels.unit}</Label>
            <Input id="attr-unit" dir="ltr" {...register('unit')} />
          </div>

          {needsAllowedValues ? (
            <Controller
              control={control}
              name="allowedValues"
              render={({ field }) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="attr-allowed-values">{labels.allowedValues}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="attr-allowed-values"
                      value={valueDraft}
                      onChange={(e) => setValueDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const next = valueDraft.trim();
                          if (next && !field.value.includes(next)) {
                            field.onChange([...field.value, next]);
                          }
                          setValueDraft('');
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        const next = valueDraft.trim();
                        if (next && !field.value.includes(next)) {
                          field.onChange([...field.value, next]);
                        }
                        setValueDraft('');
                      }}
                    >
                      {labels.addValue}
                    </Button>
                  </div>
                  <p className="text-caption text-(--color-text-muted)">
                    {labels.allowedValuesHelp}
                  </p>
                  {field.value.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {field.value.map((value) => (
                        <Badge key={value} variant="neutral" className="gap-1">
                          {value}
                          <button
                            type="button"
                            onClick={() => field.onChange(field.value.filter((v) => v !== value))}
                            aria-label={`${labels.delete} ${value}`}
                          >
                            <X className="size-3" aria-hidden="true" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {errors.allowedValues ? (
                    <p className="text-small text-(--color-error)">{labels.requiredField}</p>
                  ) : null}
                </div>
              )}
            />
          ) : null}

          <div className="flex items-center justify-between gap-3 rounded-(--radius-control) border border-(--color-border) p-3">
            <Label htmlFor="attr-required" className="cursor-pointer">
              {labels.required}
            </Label>
            <Controller
              control={control}
              name="required"
              render={({ field }) => (
                <Switch id="attr-required" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-(--radius-control) border border-(--color-border) p-3">
            <Label htmlFor="attr-filterable" className="cursor-pointer">
              {labels.filterable}
            </Label>
            <Controller
              control={control}
              name="filterable"
              render={({ field }) => (
                <Switch
                  id="attr-filterable"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {labels.cancel}
            </Button>
            <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
              {isSubmitting ? labels.saving : labels.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function typeLabelFor(type: AttributeType, labels: AttributeDefinitionsManagerLabels): string {
  return {
    TEXT: labels.typeText,
    NUMBER: labels.typeNumber,
    BOOLEAN: labels.typeBoolean,
    SELECT: labels.typeSelect,
    MULTI_SELECT: labels.typeMultiSelect,
  }[type];
}
