import { z } from 'zod';

/**
 * What a customer supplies at checkout — and nothing else.
 *
 * Note what is absent: no price, no subtotal, no discount, no total, no
 * currency, no stock, no status, no cart id. The server derives every one of
 * those from authoritative state (P10 §5). A tampered payload has nothing to
 * tamper with, because the fields do not exist in the schema — the same
 * design P09 used for cart actions, for the same reason.
 */

/**
 * An optional free-text field where an empty form input means "not given".
 *
 * The order matters. `z.string().max(n).optional().or(z.literal(''))` looks
 * equivalent but is not: `''` already satisfies the first branch, so the
 * empty-string transform never runs and a blank input is stored as `""`
 * rather than left unset. Checking for the empty string first is what makes
 * "the customer skipped this" and "the customer typed nothing" the same
 * value in the database.
 */
function optionalText(max: number) {
  return z
    .union([z.literal(''), z.string().trim().max(max)])
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : value));
}

/**
 * Saudi addresses, structured (P10 §4).
 *
 * The national address format is district + street + building number, which
 * is why this is fields rather than one free-text box: a courier needs the
 * district to route at all, and a single string cannot be validated,
 * corrected, or later used to compute a shipping zone.
 *
 * Deliberately not a global address system. `country` is fixed to SA and the
 * shape is flat, so adding a second country later means widening this schema
 * and the stored JSON — not unpicking a normalised table nobody needed yet.
 */
export const shippingAddressSchema = z.object({
  fullName: z.string().trim().min(2, 'name_too_short').max(120),
  /** Saudi mobile, normalised to +9665XXXXXXXX by `normalizeSaudiPhone`. */
  phone: z
    .string()
    .trim()
    .regex(/^\+9665\d{8}$/, 'phone_invalid'),
  city: z.string().trim().min(2).max(80),
  district: z.string().trim().min(2).max(80),
  street: z.string().trim().min(2).max(120),
  buildingNumber: z.string().trim().min(1).max(20),
  /** Four-digit extension of the national short address. Optional: many
   * customers do not know theirs, and refusing the order over it would cost
   * a sale for a field the courier can live without. */
  additionalNumber: z
    .string()
    .trim()
    .regex(/^\d{4}$/, 'additional_number_invalid')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}$/, 'postal_code_invalid')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  notes: optionalText(300),
  country: z.literal('SA').default('SA'),
});

export type ShippingAddress = z.output<typeof shippingAddressSchema>;

/**
 * Accepts the forms a Saudi customer actually types — `05XXXXXXXX`,
 * `9665XXXXXXXX`, `+966 5X XXX XXXX` — and returns one canonical value.
 *
 * Normalising before validation means a correct number is never rejected for
 * its spacing, and storing one canonical form means "have we seen this
 * customer" is answerable later without fuzzy matching.
 */
export function normalizeSaudiPhone(raw: string): string {
  const digits = raw.replace(/[\s\-()]/g, '');
  if (/^\+9665\d{8}$/.test(digits)) return digits;
  if (/^009665\d{8}$/.test(digits)) return `+${digits.slice(2)}`;
  if (/^9665\d{8}$/.test(digits)) return `+${digits}`;
  if (/^05\d{8}$/.test(digits)) return `+966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) return `+966${digits}`;
  return digits;
}

export const checkoutContactSchema = z.object({
  email: z.string().trim().toLowerCase().email('email_invalid').max(200),
  /** The order-level contact number, normalised the same way. */
  phone: z
    .string()
    .trim()
    .regex(/^\+9665\d{8}$/, 'phone_invalid'),
});

/**
 * The whole checkout submission.
 *
 * `idempotencyKey` is supplied by the client and is the one client-controlled
 * value with teeth — but it can only ever cause the customer's *own*
 * submission to be recognised as a repeat (P10 §19). It is a UUID so a
 * client cannot collide with someone else's by guessing, and it is unique
 * per order row, so a collision is a rejection rather than a cross-customer
 * leak.
 */
export const placeOrderInputSchema = z.object({
  contact: checkoutContactSchema,
  shippingAddress: shippingAddressSchema,
  note: optionalText(500),
  idempotencyKey: z.string().uuid('idempotency_key_invalid'),
});

export type PlaceOrderInput = z.input<typeof placeOrderInputSchema>;

/** Pre-normalises the phone fields so `05…` passes the regex above rather
 * than failing on a format the customer had no way to know was wrong. */
export function normalizePlaceOrderInput<T extends PlaceOrderInput>(input: T): T {
  return {
    ...input,
    contact: { ...input.contact, phone: normalizeSaudiPhone(input.contact.phone ?? '') },
    shippingAddress: {
      ...input.shippingAddress,
      phone: normalizeSaudiPhone(input.shippingAddress.phone ?? ''),
    },
  };
}
