'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { CreditCard, Loader2, Lock } from 'lucide-react';

import type { CartView } from '@/modules/cart';
import { formatMoney } from '@/modules/core/money';
// The pure schema module, not the `@/modules/orders` barrel: the barrel
// re-exports the order service, which is `server-only`, and a client
// component pulling it fails the build (by design — P01).
import { normalizeSaudiPhone, placeOrderInputSchema } from '@/modules/orders/checkout-schemas';
import type { Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { placeOrderAction } from '@/lib/orders/checkout-actions';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * The checkout form.
 *
 * Every number on this page comes from the server-rendered `cart` prop, and
 * every number in the created order is recomputed on the server again at
 * submission. Nothing here calculates a total — it only displays one and
 * collects the details an order needs (P10 §5/§20).
 */

interface CheckoutClientProps {
  cart: CartView;
  locale: Locale;
  /** A signed-in customer's own details, used only to start the form
   * pre-filled — every field stays editable and the server never trusts
   * what this form submits for identity (P10 §5, P12 §26). */
  prefill?: { email: string; fullName: string; phone: string };
}

type FieldName =
  | 'email'
  | 'phone'
  | 'fullName'
  | 'city'
  | 'district'
  | 'street'
  | 'buildingNumber'
  | 'additionalNumber'
  | 'postalCode';

const EMPTY_FORM = {
  email: '',
  phone: '',
  fullName: '',
  city: '',
  district: '',
  street: '',
  buildingNumber: '',
  additionalNumber: '',
  postalCode: '',
  addressNotes: '',
  note: '',
};

export function CheckoutClient({ cart, locale, prefill }: CheckoutClientProps) {
  const t = getDictionary(locale).checkout;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState(() =>
    prefill
      ? {
          ...EMPTY_FORM,
          email: prefill.email,
          fullName: prefill.fullName,
          phone: prefill.phone,
        }
      : EMPTY_FORM,
  );
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  /**
   * One key per form instance, generated once and reused for every retry of
   * this submission. Regenerating it on each click would defeat the point:
   * two clicks would look like two different orders to the server (P10 §19).
   * The server is what actually enforces this — the key is only how it
   * recognises the repeat.
   */
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const set = (field: keyof typeof EMPTY_FORM) => (value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (field in fieldErrors) {
      setFieldErrors((current) => {
        const next = { ...current };
        delete next[field as FieldName];
        return next;
      });
    }
  };

  const payload = useMemo(
    () => ({
      contact: { email: form.email, phone: normalizeSaudiPhone(form.phone) },
      shippingAddress: {
        fullName: form.fullName,
        phone: normalizeSaudiPhone(form.phone),
        city: form.city,
        district: form.district,
        street: form.street,
        buildingNumber: form.buildingNumber,
        additionalNumber: form.additionalNumber,
        postalCode: form.postalCode,
        notes: form.addressNotes,
        country: 'SA' as const,
      },
      note: form.note,
      idempotencyKey,
    }),
    [form, idempotencyKey],
  );

  /**
   * Client-side validation with the *same* schema the server parses with, so
   * the two can never disagree about what is acceptable. It exists to spare
   * a round trip, not to be trusted: the server validates again regardless.
   */
  function validate(): boolean {
    const result = placeOrderInputSchema.safeParse(payload);
    if (result.success) {
      setFieldErrors({});
      return true;
    }

    const messages: Record<string, string> = {
      email_invalid: t.invalidEmail,
      phone_invalid: t.invalidPhone,
      postal_code_invalid: t.invalidPostalCode,
      additional_number_invalid: t.invalidAdditionalNumber,
    };

    const next: Partial<Record<FieldName, string>> = {};
    for (const issue of result.error.issues) {
      const field = issue.path[issue.path.length - 1];
      if (typeof field !== 'string') continue;
      if (field === 'phone' || field === 'email') {
        next[field] = messages[issue.message] ?? t.required;
        continue;
      }
      next[field as FieldName] = messages[issue.message] ?? t.required;
    }

    setFieldErrors(next);
    setFormError(t.fixErrors);
    return false;
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;

    startTransition(async () => {
      const result = await placeOrderAction(locale, payload);
      if (result.ok && result.data) {
        router.push(result.data.successPath);
        return;
      }
      setFormError(result.error ?? t.errorGeneric);
    });
  }

  const currency = cart.currency;
  const money = (minor: number) => formatMoney(minor, { currency, locale });

  function field(
    name: FieldName,
    label: string,
    options: {
      type?: string;
      dir?: 'ltr' | 'rtl';
      inputMode?: 'text' | 'email' | 'tel' | 'numeric';
      optional?: boolean;
      hint?: string;
      autoComplete?: string;
    } = {},
  ) {
    const error = fieldErrors[name];
    const errorId = `${name}-error`;
    const hintId = `${name}-hint`;
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={name}>
          {label}
          {options.optional ? (
            <span className="text-(--color-text-subtle)"> ({t.optional})</span>
          ) : null}
        </Label>
        <Input
          id={name}
          name={name}
          type={options.type ?? 'text'}
          dir={options.dir}
          inputMode={options.inputMode}
          autoComplete={options.autoComplete}
          value={form[name]}
          onChange={(event) => set(name)(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : options.hint ? hintId : undefined}
          disabled={pending}
        />
        {options.hint && !error ? (
          <p id={hintId} className="text-caption text-(--color-text-subtle)" dir={options.dir}>
            {options.hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className="text-caption text-(--color-error)">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]"
      noValidate
    >
      {/* `min-w-0` for the same reason as the order pages: a long
          unbreakable run — an email address, a SKU — must not be able to
          widen the column past the viewport. */}
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle as="h2">{t.contactSection}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {field('email', t.email, {
              type: 'email',
              dir: 'ltr',
              inputMode: 'email',
              autoComplete: 'email',
            })}
            {field('phone', t.phone, {
              type: 'tel',
              dir: 'ltr',
              inputMode: 'tel',
              autoComplete: 'tel',
              hint: t.phoneHint,
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">{t.addressSection}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              {field('fullName', t.fullName, { autoComplete: 'name' })}
            </div>
            {field('city', t.city, { autoComplete: 'address-level2' })}
            {field('district', t.district, { autoComplete: 'address-level3' })}
            <div className="sm:col-span-2">
              {field('street', t.street, { autoComplete: 'address-line1' })}
            </div>
            {field('buildingNumber', t.buildingNumber, { dir: 'ltr', inputMode: 'numeric' })}
            {field('additionalNumber', t.additionalNumber, {
              dir: 'ltr',
              inputMode: 'numeric',
              optional: true,
            })}
            {field('postalCode', t.postalCode, {
              dir: 'ltr',
              inputMode: 'numeric',
              optional: true,
              autoComplete: 'postal-code',
            })}
            <div className="sm:col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="addressNotes">
                {t.addressNotes}
                <span className="text-(--color-text-subtle)"> ({t.optional})</span>
              </Label>
              <Textarea
                id="addressNotes"
                name="addressNotes"
                rows={2}
                value={form.addressNotes}
                onChange={(event) => set('addressNotes')(event.target.value)}
                disabled={pending}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">{t.noteSection}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="note">
                {t.orderNote}
                <span className="text-(--color-text-subtle)"> ({t.optional})</span>
              </Label>
              <Textarea
                id="note"
                name="note"
                rows={3}
                value={form.note}
                onChange={(event) => set('note')(event.target.value)}
                disabled={pending}
              />
            </div>
          </CardContent>
        </Card>

        {/*
          The payment boundary, stated rather than mocked (P10 §11). There is
          no card form here because there is no provider behind it, and a
          disabled-looking form that goes nowhere is a worse lie than an
          honest sentence.
        */}
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <CreditCard className="size-4 text-(--color-text-muted)" aria-hidden="true" />
              {t.paymentSection}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Alert variant="info" title={t.paymentPendingTitle}>
              {t.paymentPendingBody}
            </Alert>
          </CardContent>
        </Card>
      </div>

      <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle as="h2">{t.summarySection}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ul className="flex flex-col gap-3">
              {cart.lines.map((line) => (
                <li key={line.variantId} className="flex items-start gap-3">
                  {line.image ? (
                    <Image
                      src={line.image.src}
                      alt=""
                      width={48}
                      height={48}
                      className="size-12 flex-none rounded-(--radius-sm) object-cover"
                    />
                  ) : (
                    <span
                      className="size-12 flex-none rounded-(--radius-sm) bg-(--color-muted)"
                      aria-hidden="true"
                    />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-small text-(--color-text)">
                      {locale === 'ar' ? line.productNameAr : line.productNameEn}
                    </span>
                    {(locale === 'ar' ? line.variantLabelAr : line.variantLabelEn) ? (
                      <span className="truncate text-caption text-(--color-text-muted)">
                        {locale === 'ar' ? line.variantLabelAr : line.variantLabelEn}
                      </span>
                    ) : null}
                    <span className="text-caption text-(--color-text-muted)">
                      {t.quantityLabel}: <span className="tabular-nums">{line.quantity}</span>
                    </span>
                  </span>
                  <span className="flex-none text-small tabular-nums text-(--color-text)">
                    {money(line.lineTotalMinor)}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="flex flex-col gap-2 border-t border-(--color-border) pt-4 text-small">
              <div className="flex items-center justify-between">
                <dt className="text-(--color-text-muted)">{t.subtotal}</dt>
                <dd className="tabular-nums text-(--color-text)">{money(cart.subtotalMinor)}</dd>
              </div>
              {cart.discountMinor > 0 ? (
                <div className="flex items-center justify-between">
                  <dt className="text-(--color-text-muted)">
                    {t.discount}
                    {cart.coupon?.applied ? (
                      <span className="ms-1 font-mono text-caption">({cart.coupon.code})</span>
                    ) : null}
                  </dt>
                  <dd className="tabular-nums text-(--color-success)">
                    −{money(cart.discountMinor)}
                  </dd>
                </div>
              ) : null}
              {/* Shown, and honestly labelled: the model carries these
                  columns, and no engine fills them yet (P10 §21). */}
              <div className="flex items-center justify-between">
                <dt className="text-(--color-text-muted)">{t.shipping}</dt>
                <dd className="text-caption text-(--color-text-subtle)">{t.notCalculated}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-(--color-text-muted)">{t.tax}</dt>
                <dd className="text-caption text-(--color-text-subtle)">{t.notCalculated}</dd>
              </div>
              <div className="flex items-center justify-between border-t border-(--color-border) pt-2 text-body font-semibold">
                <dt className="text-(--color-text)">{t.total}</dt>
                <dd className="tabular-nums text-(--color-text)">{money(cart.totalMinor)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {formError ? <Alert variant="error">{formError}</Alert> : null}

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Lock className="size-4" aria-hidden="true" />
          )}
          {pending ? t.placing : t.placeOrder}
        </Button>

        <Link
          href={`/${locale}/cart`}
          className="text-center text-small text-(--color-text-muted) underline-offset-4 hover:underline"
        >
          {t.backToCart}
        </Link>
      </aside>
    </form>
  );
}
