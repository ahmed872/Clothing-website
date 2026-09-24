import { IBM_Plex_Sans_Arabic, Inter } from 'next/font/google';

/**
 * The two font families, loaded once and shared by every root layout this
 * app has (`app/[locale]/layout.tsx` for the storefront, `app/dev/layout.tsx`
 * for the P02 design-system gallery) — both need the exact same
 * `--font-latin`/`--font-arabic` CSS variables `globals.css` picks a stack
 * from per `:lang()`.
 */

export const latin = Inter({
  subsets: ['latin'],
  variable: '--font-latin',
  display: 'swap',
});

export const arabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-arabic',
  display: 'swap',
});
