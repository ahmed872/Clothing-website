import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { FittingRoom } from '@/components/storefront/fitting/fitting-room';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getOptionalCustomerAccount } from '@/lib/customers/customer-identity';
import { loadFittingRoom } from '@/lib/fitting/fitting-room';
import { getDictionary } from '@/lib/i18n/dictionary';
import { isLocale, type Locale } from '@/lib/i18n/locales';
import { FIT_PREFERENCES } from '@/modules/body-profile';
import { getStoreSettings } from '@/modules/settings';

/**
 * The virtual fitting room (clothing P04) — one product on the signed-in
 * customer's avatar. Personal, so rendered per request and kept out of
 * search engines; signed-out visitors are sent to sign in and brought back.
 */
export const dynamic = 'force-dynamic';

interface Params {
  locale: string;
  slug: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  return { title: getDictionary(locale).fitting.title, robots: { index: false, follow: false } };
}

function one(value: string | string[] | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

export default async function FittingRoomPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw, slug } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'ar';
  const query = await searchParams;
  const t = getDictionary(locale);

  const account = await getOptionalCustomerAccount();
  if (!account) {
    const here = new URLSearchParams();
    for (const key of ['color', 'size'] as const) {
      const value = one(query[key]);
      if (value) here.set(key, value);
    }
    const back = `/${locale}/fitting-room/${encodeURIComponent(slug)}${here.size ? `?${here}` : ''}`;
    redirect(`/${locale}/account/login?next=${encodeURIComponent(back)}`);
  }

  const fit = one(query.fit);
  const data = await loadFittingRoom(account.customerId, slug, {
    color: one(query.color),
    size: one(query.size),
    fit: (FIT_PREFERENCES as readonly string[]).includes(fit ?? '')
      ? (fit as (typeof FIT_PREFERENCES)[number])
      : undefined,
  });
  if (data.status === 'not_found') notFound();

  const productHref = `/${locale}/p/${slug}`;
  let body: React.ReactNode;
  if (data.status === 'not_available') {
    body = (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 p-6">
          <p className="text-body text-(--color-text)">{t.fitting.notAvailable}</p>
          <Button asChild variant="outline">
            <Link href={productHref}>{t.fitting.backToProduct}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  } else if (data.status === 'no_profile') {
    body = (
      <Card>
        <CardContent
          className="flex flex-col items-start gap-3 p-6"
          data-testid="fitting-no-profile"
        >
          <h2 className="text-h5 text-(--color-text)">{t.fitting.noProfile.title}</h2>
          <p className="text-body text-(--color-text-muted)">{t.fitting.noProfile.body}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={`/${locale}/account/body-profile`}>{t.fitting.noProfile.cta}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={productHref}>{t.fitting.backToProduct}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  } else {
    const settings = await getStoreSettings(locale);
    body = (
      <FittingRoom
        locale={locale}
        data={data}
        currency={settings.currency}
        t={{
          fitting: t.fitting,
          sizing: t.sizing,
          bodyProfile: t.bodyProfile,
          product: t.product,
          cart: t.cart,
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-h3 text-(--color-text)">{t.fitting.title}</h1>
      {body}
    </div>
  );
}
