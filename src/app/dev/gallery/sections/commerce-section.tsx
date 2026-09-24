'use client';

import * as React from 'react';

import type { Locale } from '../gallery-shell';
import { SectionHeading, SubHeading } from './section-heading';

import { ProductCard } from '@/components/commerce/product-card';
import { ProductPrice } from '@/components/commerce/product-price';
import { DiscountBadge } from '@/components/commerce/discount-badge';
import { StockBadge } from '@/components/commerce/stock-badge';
import { Rating } from '@/components/commerce/rating';
import { QuantitySelector } from '@/components/commerce/quantity-selector';
import { ProductGallery } from '@/components/commerce/product-gallery';
import { ProductImage } from '@/components/commerce/product-image';

const SAMPLE_PRODUCTS = [
  {
    name: { ar: 'رنج روفر فيلار 2026', en: 'Range Rover Velar 2026' },
    priceMinor: 45_000_00,
    compareAtMinor: 52_000_00,
    ratingValue: 4.5,
    ratingCount: 128,
    stockStatus: 'in-stock' as const,
  },
  {
    name: { ar: 'حذاء رياضي جلد طبيعي', en: 'Leather running shoe' },
    priceMinor: 349_00,
    compareAtMinor: null,
    ratingValue: 4.2,
    ratingCount: 34,
    stockStatus: 'low-stock' as const,
  },
  {
    name: { ar: 'سماعات لاسلكية عازلة للضوضاء', en: 'Wireless noise-cancelling headphones' },
    priceMinor: 899_00,
    compareAtMinor: 1_099_00,
    ratingValue: 4.8,
    ratingCount: 512,
    stockStatus: 'out-of-stock' as const,
  },
];

export function CommerceSection({ locale }: { locale: Locale }) {
  const [quantity, setQuantity] = React.useState(2);

  return (
    <section className="flex flex-col gap-10">
      <SectionHeading
        id="commerce"
        title={locale === 'ar' ? 'عناصر المتجر' : 'Commerce primitives'}
        description={
          locale === 'ar'
            ? 'بصرية فقط — لا منطق سلة أو مخزون هنا.'
            : 'Visual only — no cart or inventory logic lives here.'
        }
      />

      <div className="flex flex-col gap-3">
        <SubHeading>ProductCard</SubHeading>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {SAMPLE_PRODUCTS.map((product) => (
            <ProductCard
              key={product.name.en}
              href="#"
              name={product.name[locale]}
              priceMinor={product.priceMinor}
              compareAtMinor={product.compareAtMinor}
              locale={locale}
              ratingValue={product.ratingValue}
              ratingCount={product.ratingCount}
              stockStatus={product.stockStatus}
            />
          ))}
          <ProductCard
            href="#"
            name={locale === 'ar' ? 'منتج بدون صورة بعد' : 'Product with no image yet'}
            priceMinor={199_00}
            locale={locale}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <SubHeading>ProductPrice · DiscountBadge · StockBadge</SubHeading>
          <div className="flex flex-col gap-3 rounded-(--radius-surface) border border-(--color-border) p-4">
            <ProductPrice priceMinor={45_000_00} compareAtMinor={52_000_00} locale={locale} />
            <ProductPrice priceMinor={899_00} locale={locale} />
            <div className="flex flex-wrap gap-2">
              <DiscountBadge percentOff={13} />
              <StockBadge status="in-stock" locale={locale} />
              <StockBadge
                status="low-stock"
                locale={locale}
                quantityLabel={locale === 'ar' ? '3 قطع فقط' : 'Only 3 left'}
              />
              <StockBadge status="out-of-stock" locale={locale} />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <SubHeading>Rating · QuantitySelector</SubHeading>
          <div className="flex flex-col gap-4 rounded-(--radius-surface) border border-(--color-border) p-4">
            <Rating value={4.5} count={128} locale={locale} />
            <Rating value={2} size="md" locale={locale} />
            <QuantitySelector
              value={quantity}
              onChange={setQuantity}
              max={10}
              decreaseLabel={locale === 'ar' ? 'إنقاص الكمية' : 'Decrease quantity'}
              increaseLabel={locale === 'ar' ? 'زيادة الكمية' : 'Increase quantity'}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <SubHeading>ProductGallery</SubHeading>
          <div className="max-w-xs">
            <ProductGallery
              images={[
                { src: '', alt: locale === 'ar' ? 'الصورة الأمامية' : 'Front view' },
                { src: '', alt: locale === 'ar' ? 'الصورة الجانبية' : 'Side view' },
                { src: '', alt: locale === 'ar' ? 'المقصورة الداخلية' : 'Interior' },
              ]}
              thumbnailsLabel={locale === 'ar' ? 'صور المنتج' : 'Product images'}
              noImageLabel={locale === 'ar' ? 'لا توجد صورة' : 'No image'}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <SubHeading>ProductImage (fallback)</SubHeading>
          <div className="max-w-xs">
            <ProductImage
              src={null}
              alt=""
              noImageLabel={locale === 'ar' ? 'لا توجد صورة' : 'No image'}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
