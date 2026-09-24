/**
 * What may be kept from a provider's payload (P11 §2).
 *
 * An allowlist, not a denylist. A denylist is a list of the sensitive fields
 * somebody thought of, and the next provider version adds one nobody did —
 * a payload can carry a cardholder name, a PAN echo, a CVV result, a
 * one-time auth token or the customer's full billing address, and storing
 * "everything except the bits we blocked" means storing whichever of those
 * is new.
 *
 * So nothing is stored unless it is named here, and the names are the
 * reconciliation facts a support agent or an accountant actually needs.
 */

export const ALLOWED_PROVIDER_METADATA_KEYS = [
  'id',
  'status',
  'amount',
  'currency',
  'reference',
  'event_type',
  'created_at',
  'occurred_at',
  'failure_code',
  'failure_message',
  'payment_method_type',
  /** Last four digits only — the provider sends this as its own field; the
   * full number is never in an allowlisted key. */
  'card_last4',
  'card_brand',
] as const;

const ALLOWED = new Set<string>(ALLOWED_PROVIDER_METADATA_KEYS);

/** Values longer than this are truncated: a payload field is not a log sink,
 * and an unbounded string on every payment row is how a payments table
 * becomes the biggest thing in the database. */
const MAX_VALUE_LENGTH = 256;

function scalar(value: unknown): string | number | boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
  }
  // Objects and arrays are dropped entirely rather than walked. A nested
  // object is exactly where an unexpected secret hides, and no
  // reconciliation need justifies keeping one.
  return undefined;
}

export function redactProviderPayload(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (!ALLOWED.has(key)) continue;
    const kept = scalar(value);
    if (kept !== undefined) out[key] = kept;
  }
  return out;
}
