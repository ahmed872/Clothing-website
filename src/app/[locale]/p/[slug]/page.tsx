import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getProductDetailBySlug, getProductReviews, getRelatedProducts } from '@/modules/catalog';
import { getStoreSettings } from '@/modules/settings';
import { clientEnv } from '@/modules/core/env.client';
import { isLocale, type Locale } from '@/lib/i18n/locales';
import { getDictionary } from '@/lib/i18n/dictionary';
import { StorefrontBreadcrumbs } from '@/components/storefront/listing/storefront-breadcrumbs';
import { StructuredData } from '@/components/storefront/structured-data';
import { ProductGallery } from '@/components/commerce/product-gallery';
import { Rating } from '@/components/commerce/rating';
import { PurchasePanel } from '@/components/storefront/pdp/purchase-panel';
import { SpecificationsTable } from '@/components/storefront/pdp/specifications-table';
import { ReviewsSection } from '@/components/storefront/pdp/reviews-section';
import { RecentlyViewedRail, RecordProductView } from '@/components/storefront/pdp/recently-viewed';
import { ProductGrid } from '@/components/storefront/product-grid';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export const revalidate = 60;

interface ProductPageParams {
  locale: string;
  slug: string;
}

async function resolveProduct(params: Promise<ProductPageParams>) {
  const { locale: rawLocale, slug } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : 'ar';
  const product = await getProductDetailBySlug(slug);
  return { locale, product };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<ProductPageParams>;
}): Promise<Metadata> {
  const { locale, product } = await resolveProduct(params);
  if (!product) return {};

  const name = locale === 'ar' ? product.nameAr : product.nameEn;
  const seoTitle = (locale === 'ar' ? product.seoTitleAr : product.seoTitleEn) ?? name;
  const description =
    (locale === 'ar' ? product.seoDescriptionAr : product.seoDescriptionEn) ??
    (locale === 'ar' ? product.descriptionAr : product.descriptionEn) ??
    undefined;
  const image = product.images[0];

  return {
    title: seoTitle,
    description,
    alternates: {
      canonical: `/${locale}/p/${product.slug}`,
      languages: {
        ar: `/ar/p/${product.slug}`,
        en: `/en/p/${product.slug}`,
        'x-default': `/ar/p/${product.slug}`,
      },
    },
    openGraph: {
      title: seoTitle,
      description,
      type: 'website',
      images: image ? [{ url: image.src, alt: image.alt }] : undefined,
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<ProductPageParams> }) {
  const { locale, product } = await resolveProduct(params);
  if (!product) notFound();

  const t = getDictionary(locale);
  const [reviews, related, settings] = await Promise.all([
    getProductReviews(product.id),
    getRelatedProducts(product.id, product.category.id, locale),
    getStoreSettings(locale),
  ]);

  const name = locale === 'ar' ? product.nameAr : product.nameEn;
  const brandName = product.brand
    ? locale === 'ar'
      ? product.brand.nameAr
      : product.brand.nameEn
    : null;
  const description = locale === 'ar' ? product.descriptionAr : product.descriptionEn;

  const trail: { label: string; href?: string }[] = [
    ...product.breadcrumb.map((c) => ({
      label: locale === 'ar' ? c.nameAr : c.nameEn,
      href: `/${locale}/c/${c.slug}`,
    })),
    { label: name },
  ];

  const primaryImage = product.images[0];
  const siteUrl = clientEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  const canonicalUrl = `${siteUrl}/${locale}/p/${product.slug}`;
  const defaultVariant = product.variants.find((v) => v.id === product.defaultVariantId);

  const productJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description: description ?? undefined,
    sku: defaultVariant?.sku,
    image: product.images.map((image) => image.src),
    brand: brandName ? { '@type': 'Brand', name: brandName } : undefined,
    offers: defaultVariant
      ? {
          '@type': 'Offer',
          url: canonicalUrl,
          priceCurrency: settings.currency,
          price: (defaultVariant.price.currentMinor / 100).toFixed(2),
          availability:
            defaultVariant.stockStatus === 'out-of-stock'
              ? 'https://schema.org/OutOfStock'
              : 'https://schema.org/InStock',
        }
      : undefined,
    aggregateRating: product.rating
      ? {
          '@type': 'AggregateRating',
          ratingValue: product.rating.value,
          reviewCount: product.rating.count,
        }
      : undefined,
  };

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: locale === 'ar' ? 'الرئيسية' : 'Home',
        item: `${siteUrl}/${locale}`,
      },
      ...trail.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 2,
        name: item.label,
        item: item.href ? `${siteUrl}${item.href}` : canonicalUrl,
      })),
    ],
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
      <StructuredData data={productJsonLd} />
      <StructuredData data={breadcrumbJsonLd} />
      <StorefrontBreadcrumbs locale={locale} trail={trail} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-12">
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
          <h1 className="text-h2 text-(--color-text)">{name}</h1>
          {product.rating ? (
            <Rating
              value={product.rating.value}
              count={product.rating.count}
              locale={locale}
              size="md"
            />
          ) : null}

          <PurchasePanel product={product} locale={locale} currency={settings.currency} />
        </div>
      </div>

      <Tabs defaultValue="description" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="description">{t.product.description}</TabsTrigger>
          {product.specifications.length > 0 ? (
            <TabsTrigger value="specifications">{t.product.specifications}</TabsTrigger>
          ) : null}
          <TabsTrigger value="reviews">
            {t.product.reviews}
            {product.rating ? ` (${product.rating.count})` : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="description">
          {description ? (
            <p className="max-w-3xl text-body whitespace-pre-line text-(--color-text)">
              {description}
            </p>
          ) : (
            <p className="text-small text-(--color-text-muted)">
              {locale === 'ar' ? 'لا يوجد وصف بعد.' : 'No description yet.'}
            </p>
          )}
        </TabsContent>

        {product.specifications.length > 0 ? (
          <TabsContent value="specifications">
            <SpecificationsTable specifications={product.specifications} locale={locale} />
          </TabsContent>
        ) : null}

        <TabsContent value="reviews">
          <ReviewsSection reviews={reviews} rating={product.rating} locale={locale} />
        </TabsContent>
      </Tabs>

      {related.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-h3 text-(--color-text)">{t.product.relatedProducts}</h2>
          <ProductGrid items={related} locale={locale} />
        </section>
      ) : null}

      <RecentlyViewedRail
        excludeProductId={product.id}
        locale={locale}
        currency={settings.currency}
      />
      <RecordProductView
        id={product.id}
        slug={product.slug}
        nameAr={product.nameAr}
        nameEn={product.nameEn}
        image={primaryImage ? { src: primaryImage.src, alt: primaryImage.alt } : null}
        priceMinor={product.variants[0]?.price.currentMinor ?? 0}
      />
    </div>
  );
}
