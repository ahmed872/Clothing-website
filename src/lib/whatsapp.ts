/**
 * Turning a stored phone number into a `wa.me` link.
 *
 * `wa.me` wants a bare international number — country code first, no `+`,
 * no `00`, no spaces or dashes. A store owner types their number however
 * they hold it in their head, and the two forms they most often reach for
 * are exactly the two that break the link:
 *
 *   - `+20 10 3033884` — the `+` is stripped by any digits-only filter, so
 *     this one survives naively.
 *   - `0020103033884` — the international *dialling prefix*. Digits-only
 *     keeps the leading `00`, and `wa.me/0020103033884` opens WhatsApp on a
 *     number that does not exist. This is the one that was shipped broken.
 *
 * A single leading `0` is left alone on purpose: that is a national trunk
 * prefix (`010…` in Egypt, `05…` in Saudi Arabia), and it is not this
 * function's job to guess a country code that was never given. Such a
 * number is not internationally dialable, so `whatsappHref` returns `null`
 * rather than building a link that silently fails — the number still
 * renders as text, it just is not offered as a WhatsApp link.
 */

export function normalizeWhatsappNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits === '') return null;

  // `00` is the international access prefix, not part of the number.
  const withoutPrefix = digits.startsWith('00') ? digits.slice(2) : digits;

  // A number still starting with `0` is national-format: no country code,
  // so it cannot be dialled internationally and `wa.me` cannot use it.
  if (withoutPrefix.startsWith('0')) return null;

  // Shortest plausible international number is a country code plus a
  // subscriber number; anything under this is a typo, not a phone number.
  if (withoutPrefix.length < 8 || withoutPrefix.length > 15) return null;

  return withoutPrefix;
}

export function whatsappHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const number = normalizeWhatsappNumber(raw);
  return number ? `https://wa.me/${number}` : null;
}
