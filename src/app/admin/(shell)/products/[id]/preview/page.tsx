import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { ArrowLeft, ExternalLink } from 'lucide-react';

import { getProductDetailForPreview } from '@/modules/catalog';
import { getStoreSettings } from '@/modules/settings';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { getDictionary } from '@/lib/i18n/dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ProductGallery } from '@/components/commerce/product-gallery';
import { PurchasePanel } from '@/components/storefront/pdp/purchase-panel';
import { SpecificationsTable } from '@/components/storefront/pdp/specifications-table';

export const metadata: Metadata = {
  title: 'Product preview',
  // A preview is an internal view of possibly-unpublished content: it must
  // never end up in an index, even though it is already behind auth.
  robots: { index: false, follow: false },
};

/**
 * P07 §10's preview. Three things it deliberately is *not*:
 *
 * - Not authorized by a secret in the URL. It is an ordinary admin route
 *   behind `requirePermission('products.read')`; someone who guesses the id
 *   without a session gets the login page, exactly like every other admin
 *   route.
 * - Not a public exposure of a draft. The storefront's own
 *   `getProductDetailBySlug` still refuses anything that isn't PUBLISHED —
 *   this page uses a separate, admin-only read.
 * - Not a state change. Nothing here writes: no view counter, no status
 *   flip, no "last previewed" stamp.
 *
 * It renders the same components the storefront product page uses, so what
 * an admin checks here is the real presentation rather than an
 * approximation of it.
 */
export default async function ProductPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPermission('products.read');
  const { id } = await params;

  const product = await getProductDetailForPreview(id);
  if (!product) notFound();

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);
  const storefront = getDictionary(locale);
  const settings = await getStoreSettings(locale);

  const name = locale === 'ar' ? product.nameAr : product.nameEn;
  const brandName = product.brand
    ? locale === 'ar'
      ? product.brand.nameAr
      : product.brand.nameEn
    : null;
  const description = locale === 'ar' ? product.descriptionAr : product.descriptionEn;
  const isPublished = product.publishedAt !== null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.status.previewTitle}
        description={name}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[
              { label: t.products.title, href: '/admin/products' },
              { label: name, href: `/admin/products/${product.id}` },
              { label: t.status.preview },
            ]}
          />
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/admin/products/${product.id}`}>
                <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
                {t.status.backToEdit}
              </Link>
            </Button>
            {isPublished ? (
              <Button asChild variant="outline">
                <Link href={`/${locale}/p/${product.slug}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" aria-hidden="true" />
                  {t.status.viewInStore}
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <Alert variant={isPublished ? 'info' : 'warning'}>
        {isPublished ? t.status.previewBannerPublished : t.status.previewBanner}
      </Alert>

      <div className="rounded-(--radius-surface) border border-(--color-border) bg-(--color-background) p-4 sm:p-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-8">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <ProductGallery
              images={product.images}
              thumbnailsLabel={locale === 'ar' ? 'صور المنتج' : 'Product images'}
              noImageLabel={locale === 'ar' ? undefined : 'No image'}
            />

            <div className="flex flex-col gap-4">
              {brandName ? (
                <p className="text-caption font-medium text-(--color-text-muted) uppercase">
                  {brandName}
                </p>
              ) : null}
              <h2 className="text-h2 text-(--color-text)">{name}</h2>
              <PurchasePanel product={product} locale={locale} currency={settings.currency} />
            </div>
          </div>

          {description ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-h6 text-(--color-text)">{storefront.product.description}</h3>
              <p className="max-w-3xl text-body whitespace-pre-line text-(--color-text)">
                {description}
              </p>
            </div>
          ) : null}

          {product.specifications.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-h6 text-(--color-text)">{storefront.product.specifications}</h3>
              <SpecificationsTable specifications={product.specifications} locale={locale} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
