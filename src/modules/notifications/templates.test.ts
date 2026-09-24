import { describe, expect, it } from 'vitest';

import { buildPasswordResetEmail, buildVerificationEmail, type EmailCopy } from './templates';

const AR_COPY: EmailCopy = {
  htmlLang: 'ar',
  dir: 'rtl',
  subject: 'تأكيد بريدك الإلكتروني — LuxeDrive',
  heading: 'تأكيد بريدك الإلكتروني',
  greeting: 'مرحبًا أحمد،',
  body: 'شكرًا لإنشاء حساب في LuxeDrive.',
  ctaLabel: 'تأكيد البريد الإلكتروني',
  expiryNotice: 'ينتهي هذا الرابط خلال 24 ساعة.',
  ignoreNotice: 'إذا لم تُنشئ هذا الحساب، يمكنك تجاهل هذه الرسالة بأمان.',
  fallbackNotice: 'إذا لم يعمل الزر، انسخ الرابط التالي والصقه في متصفحك:',
  footer: '© 2026 LuxeDrive. جميع الحقوق محفوظة.',
  automatedNotice: 'هذه رسالة آلية، يرجى عدم الرد عليها.',
};

const EN_COPY: EmailCopy = {
  htmlLang: 'en',
  dir: 'ltr',
  subject: 'Reset your password — LuxeDrive',
  heading: 'Reset your password',
  greeting: 'Hi Ahmed,',
  body: 'We received a request to reset your password.',
  ctaLabel: 'Reset password',
  expiryNotice: 'This link expires in 1 hour.',
  ignoreNotice: "If you didn't request this, ignore this email.",
  fallbackNotice: "If the button doesn't work, copy and paste this link:",
  footer: '© 2026 LuxeDrive. All rights reserved.',
  automatedNotice: 'This is an automated message.',
};

describe('buildVerificationEmail', () => {
  it('composes the message from the recipient, url, and pre-translated copy', () => {
    const message = buildVerificationEmail({
      to: 'shopper@example.com',
      toName: 'Ahmed',
      ctaUrl: 'https://luxedrive.example/ar/account/verify-email?token=abc123',
      copy: AR_COPY,
    });

    expect(message.to).toBe('shopper@example.com');
    expect(message.toName).toBe('Ahmed');
    expect(message.subject).toBe(AR_COPY.subject);
    expect(message.html).toContain('dir="rtl"');
    expect(message.html).toContain('lang="ar"');
    expect(message.html).toContain(
      'https://luxedrive.example/ar/account/verify-email?token=abc123',
    );
    expect(message.text).toContain(
      'https://luxedrive.example/ar/account/verify-email?token=abc123',
    );
    expect(message.text).toContain(AR_COPY.greeting);
  });

  it('carries the exact url given, unaltered, and no other host', () => {
    const url = 'https://luxedrive.example/en/account/verify-email?token=xyz';
    const message = buildVerificationEmail({
      to: 'shopper2@example.com',
      toName: null,
      ctaUrl: url,
      copy: EN_COPY,
    });
    // The button href, and the visible fallback link, both carry this exact
    // url — never a different one, never a host this test didn't supply.
    expect(message.html).toContain(`href="${url}"`);
    expect(message.html).toContain(`>${url}<`);
    expect(message.html.match(/href="https?:\/\/[^"]*"/g)).toEqual([
      `href="${url}"`,
      `href="${url}"`,
    ]);
  });

  it('escapes HTML-significant characters in copy, so a display name cannot break out of the markup', () => {
    const message = buildVerificationEmail({
      to: 'shopper@example.com',
      toName: '<script>alert(1)</script>',
      ctaUrl: 'https://luxedrive.example/en/account/verify-email?token=abc',
      copy: { ...EN_COPY, greeting: 'Hi <script>alert(1)</script>,' },
    });
    expect(message.html).not.toContain('<script>alert(1)</script>');
    expect(message.html).toContain('&lt;script&gt;');
  });
});

describe('buildPasswordResetEmail', () => {
  it('composes the message the same way, for the reset copy/url', () => {
    const message = buildPasswordResetEmail({
      to: 'shopper@example.com',
      toName: 'Ahmed',
      ctaUrl: 'https://luxedrive.example/en/account/reset-password?token=def456',
      copy: EN_COPY,
    });

    expect(message.subject).toBe(EN_COPY.subject);
    expect(message.html).toContain('dir="ltr"');
    expect(message.html).toContain(
      'https://luxedrive.example/en/account/reset-password?token=def456',
    );
  });

  it('always includes a plain-text alternative with the real link', () => {
    const message = buildPasswordResetEmail({
      to: 'shopper@example.com',
      toName: null,
      ctaUrl: 'https://luxedrive.example/ar/account/reset-password?token=ghi789',
      copy: AR_COPY,
    });
    expect(message.text.length).toBeGreaterThan(0);
    expect(message.text).toContain(
      'https://luxedrive.example/ar/account/reset-password?token=ghi789',
    );
  });
});
