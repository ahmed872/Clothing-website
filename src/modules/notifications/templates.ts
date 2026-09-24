import type { EmailMessage } from './provider';

/**
 * Verification and password-reset email content (P13 §3/§11).
 *
 * Plain template-literal functions, not a component framework: an email's
 * "render" target is an HTML string handed to an SMTP client, never
 * anything React touches, and these two templates are the entire surface —
 * pulling in a rendering library for two templates would be the dependency
 * this project's own conventions warn against adding before proving the
 * simpler thing insufficient.
 *
 * `notifications` may depend on `core`/`settings` only (its own module
 * boundary comment: "callers pass data in") — it has no path to
 * `@/lib/i18n/dictionary`, so every word below arrives pre-translated as
 * `EmailCopy`. The caller (`src/lib/notifications/email-dispatcher.ts`, a
 * `lib` file that can freely cross module boundaries) is the one that reads
 * the dictionary and decides which locale's strings to hand in.
 *
 * Email HTML has real, well-known constraints most web HTML does not: no
 * external stylesheet (most clients strip `<style>` in the `<head>` or
 * ignore it entirely), a table-based layout for the mail clients that still
 * don't reliably support flexbox/grid, and every color/spacing value inlined
 * on the element itself. `renderLayout` below is the one place that
 * boilerplate lives, so the two real templates only supply their own copy.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Every string this template needs, already translated and interpolated —
 * this module never looks anything up by locale itself. */
export interface EmailCopy {
  /** BCP-47-ish tag for the `<html lang>` attribute — not consumed for
   * lookup, just echoed into the markup. */
  htmlLang: string;
  dir: 'rtl' | 'ltr';
  subject: string;
  heading: string;
  greeting: string;
  body: string;
  ctaLabel: string;
  expiryNotice: string;
  ignoreNotice: string;
  fallbackNotice: string;
  footer: string;
  automatedNotice: string;
}

/** Brand color matches `StoreSettings.brandColor`'s own seeded default
 * (`#0D1B2A`) — the one place outside admin settings this app's brand navy
 * is spelled out literally, same as the hardcoded "LuxeDrive" wordmark
 * already used in the admin shell header. */
const BRAND_COLOR = '#0D1B2A';

function renderHtml(copy: EmailCopy, ctaUrl: string): string {
  const align = copy.dir === 'rtl' ? 'right' : 'left';
  return `<!doctype html>
<html lang="${escapeHtml(copy.htmlLang)}" dir="${copy.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(copy.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;font-family:Arial,Helvetica,sans-serif;">
<span style="display:none;font-size:1px;color:#F4F4F5;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(copy.body)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F4F4F5;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" style="max-width:480px;background-color:#FFFFFF;border-radius:8px;overflow:hidden;" cellpadding="0" cellspacing="0">
<tr><td style="background-color:${BRAND_COLOR};padding:20px 24px;text-align:${align};">
<span style="color:#FFFFFF;font-size:18px;font-weight:bold;">LuxeDrive</span>
</td></tr>
<tr><td style="padding:32px 24px;text-align:${align};color:#111827;">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;">${escapeHtml(copy.heading)}</h1>
<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">${escapeHtml(copy.greeting)}</p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">${escapeHtml(copy.body)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
<tr><td style="border-radius:6px;background-color:${BRAND_COLOR};">
<a href="${ctaUrl}" style="display:inline-block;padding:12px 28px;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:bold;border-radius:6px;">${escapeHtml(copy.ctaLabel)}</a>
</td></tr>
</table>
<p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#6B7280;">${escapeHtml(copy.expiryNotice)}</p>
<p style="margin:0 0 16px;font-size:12px;line-height:1.6;color:#6B7280;">${escapeHtml(copy.ignoreNotice)}</p>
<p style="margin:0 0 4px;font-size:12px;line-height:1.6;color:#6B7280;">${escapeHtml(copy.fallbackNotice)}</p>
<p style="margin:0;font-size:12px;line-height:1.6;word-break:break-all;"><a href="${ctaUrl}" style="color:${BRAND_COLOR};">${escapeHtml(ctaUrl)}</a></p>
</td></tr>
<tr><td style="padding:16px 24px;background-color:#F4F4F5;text-align:${align};">
<p style="margin:0 0 4px;font-size:11px;color:#9CA3AF;">${escapeHtml(copy.automatedNotice)}</p>
<p style="margin:0;font-size:11px;color:#9CA3AF;">${escapeHtml(copy.footer)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function renderText(copy: EmailCopy, ctaUrl: string): string {
  return [
    copy.greeting,
    '',
    copy.body,
    '',
    `${copy.ctaLabel}: ${ctaUrl}`,
    '',
    copy.expiryNotice,
    copy.ignoreNotice,
    '',
    copy.automatedNotice,
    copy.footer,
  ].join('\n');
}

export interface BuildEmailInput {
  to: string;
  toName: string | null;
  ctaUrl: string;
  copy: EmailCopy;
}

/** The one renderer both templates below use — kept generic (not named
 * "verification" or "reset" anywhere in its own body) so a third email type
 * later is a new copy object and a thin wrapper, not a second layout. */
function build(input: BuildEmailInput): EmailMessage {
  return {
    to: input.to,
    toName: input.toName,
    subject: input.copy.subject,
    html: renderHtml(input.copy, input.ctaUrl),
    text: renderText(input.copy, input.ctaUrl),
  };
}

export function buildVerificationEmail(input: BuildEmailInput): EmailMessage {
  return build(input);
}

export function buildPasswordResetEmail(input: BuildEmailInput): EmailMessage {
  return build(input);
}
