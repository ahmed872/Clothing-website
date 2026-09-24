import type { Metadata } from 'next';

import { GalleryShell } from './gallery-shell';

/**
 * The design system's visual reference (P02). Every token, base component
 * and visual primitive lives on this one page so a later phase can check
 * "does this already exist?" before building something new. Not part of the
 * storefront or admin — noindex, and not linked from either.
 */
export const metadata: Metadata = {
  title: 'Design Gallery — LuxeDrive',
  robots: { index: false, follow: false },
};

export default function GalleryPage() {
  return <GalleryShell />;
}
