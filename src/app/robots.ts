import type { MetadataRoute } from 'next';

import { clientEnv } from '@/modules/core/env.client';

/**
 * `/api/*` and `/dev/*` (the P02 design-system gallery, never a real
 * storefront page) are disallowed outright. `/search` is *not* disallowed
 * here — it's excluded from the sitemap and marked `noindex` in its own
 * `generateMetadata` instead, so a crawler can still follow a link into it
 * and see that instruction directly, rather than being blocked from ever
 * reaching the page (Google's own guidance: `noindex` needs the page to be
 * crawlable to take effect).
 */
export default function robots(): MetadataRoute.Robots {
  const siteUrl = clientEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');

  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/dev/'] },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
