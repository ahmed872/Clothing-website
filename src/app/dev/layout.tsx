import type { Metadata } from 'next';

import { latin, arabic } from '@/lib/fonts';
import { THEME_BOOTSTRAP } from '@/lib/theme-bootstrap';

import '../globals.css';

/**
 * `/dev/*`'s own root layout (P02, relocated in P05). Not part of the
 * locale-prefixed storefront — `/dev/gallery` manages its own `lang`/`dir`/
 * theme entirely client-side (`gallery-shell.tsx`) — so this only provides
 * the two things every root layout must: `<html>`/`<body>` and the fonts /
 * theme-flash-prevention script every page needs, identical to
 * `app/[locale]/layout.tsx`'s copy. See the Next.js "multiple root layouts"
 * pattern: `[locale]` and `dev` are sibling top-level segments, so each
 * needs its own.
 */
export const metadata: Metadata = {
  title: 'LuxeDrive — Design System',
  robots: { index: false, follow: false },
};

export default function DevRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${latin.variable} ${arabic.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
