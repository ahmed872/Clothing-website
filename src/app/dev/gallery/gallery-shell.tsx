'use client';

import * as React from 'react';
import { Direction } from 'radix-ui';
import { Languages, Moon, Sun } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toast';

import { TokensSection } from './sections/tokens-section';
import { ComponentsSection } from './sections/components-section';
import { CommerceSection } from './sections/commerce-section';
import { AdminSection } from './sections/admin-section';

type Theme = 'light' | 'dark';
type Locale = 'ar' | 'en';

const COPY = {
  ar: {
    title: 'مرجع نظام التصميم',
    subtitle:
      'كل رمز تصميم ومكوّن أساسي وعنصر بصري خاص بالتجارة والإدارة — في مكان واحد. Light/Dark وArabic/English وRTL/LTR قابلة للتبديل هنا مباشرة.',
    theme: 'المظهر',
    locale: 'اللغة',
    nav: {
      tokens: 'الرموز',
      components: 'المكوّنات',
      commerce: 'عناصر المتجر',
      admin: 'عناصر الإدارة',
    },
  },
  en: {
    title: 'Design System Gallery',
    subtitle:
      'Every design token, base component and commerce/admin visual primitive — in one place. Light/Dark and Arabic/English/RTL/LTR toggle live, right here.',
    theme: 'Theme',
    locale: 'Language',
    nav: { tokens: 'Tokens', components: 'Components', commerce: 'Commerce', admin: 'Admin' },
  },
} as const;

export function GalleryShell() {
  const [theme, setTheme] = React.useState<Theme>('light');
  const [locale, setLocale] = React.useState<Locale>('ar');
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const t = COPY[locale];

  return (
    <Direction.Provider dir={dir}>
      <TooltipProvider>
        <div
          lang={locale}
          dir={dir}
          data-theme={theme}
          className="min-h-screen bg-(--color-background) text-(--color-text)"
        >
          <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-4 border-b border-(--color-border) bg-(--color-surface)/95 px-6 py-4 backdrop-blur-sm">
            <div className="flex flex-col gap-0.5">
              <p className="text-h6">{t.title}</p>
              <p className="max-w-2xl text-caption text-(--color-text-muted)">{t.subtitle}</p>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-(--radius-control) border border-(--color-border) p-0.5">
                <Button
                  type="button"
                  variant={theme === 'light' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setTheme('light')}
                  aria-pressed={theme === 'light'}
                >
                  <Sun aria-hidden="true" />
                  {t.theme === 'المظهر' ? 'فاتح' : 'Light'}
                </Button>
                <Button
                  type="button"
                  variant={theme === 'dark' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setTheme('dark')}
                  aria-pressed={theme === 'dark'}
                >
                  <Moon aria-hidden="true" />
                  {t.theme === 'المظهر' ? 'داكن' : 'Dark'}
                </Button>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
              >
                <Languages aria-hidden="true" />
                {locale === 'ar' ? 'English' : 'العربية'}
              </Button>
            </div>
          </header>

          <div className="mx-auto flex max-w-7xl gap-8 px-6 py-8">
            <nav
              aria-label={locale === 'ar' ? 'أقسام الصفحة' : 'Page sections'}
              className="sticky top-24 hidden h-fit w-40 shrink-0 flex-col gap-1 text-sm lg:flex"
            >
              {Object.entries(t.nav).map(([key, label]) => (
                <a
                  key={key}
                  href={`#${key}`}
                  className="rounded-(--radius-sm) px-2 py-1.5 text-(--color-text-muted) transition-colors duration-(--duration-fast) hover:bg-(--color-surface-raised) hover:text-(--color-text)"
                >
                  {label}
                </a>
              ))}
            </nav>

            <main className={cn('flex min-w-0 flex-1 flex-col gap-16')}>
              <TokensSection locale={locale} />
              <ComponentsSection locale={locale} />
              <CommerceSection locale={locale} />
              <AdminSection locale={locale} />
            </main>
          </div>

          <Toaster closeLabel={locale === 'ar' ? 'إغلاق' : 'Close'} />
        </div>
      </TooltipProvider>
    </Direction.Provider>
  );
}

export type { Locale, Theme };
