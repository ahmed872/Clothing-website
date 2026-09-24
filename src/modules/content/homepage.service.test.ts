import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';
import { createCategory, createProduct, publishProduct } from '@/modules/catalog';
import { resetCatalogTables } from '@/modules/catalog/testing';

import { buildFallbackHomepageSections, getPublishedHomepageSections } from './homepage.service';

beforeEach(async () => {
  await db.homepageSection.deleteMany();
  await resetCatalogTables();
});

describe('getPublishedHomepageSections', () => {
  it('returns nothing when no sections exist — an honest empty homepage, not a crash', async () => {
    expect(await getPublishedHomepageSections()).toEqual([]);
  });

  it('never returns a disabled section', async () => {
    await db.homepageSection.create({
      data: {
        type: 'HERO',
        position: 0,
        enabled: false,
        config: { titleAr: 'أ', titleEn: 'A' },
      },
    });
    expect(await getPublishedHomepageSections()).toEqual([]);
  });

  it('never reads draftConfig, only the published config', async () => {
    await db.homepageSection.create({
      data: {
        type: 'HERO',
        position: 0,
        enabled: true,
        config: { titleAr: 'منشور', titleEn: 'Published' },
        draftConfig: { titleAr: 'مسودة', titleEn: 'Draft — should never appear' },
      },
    });

    const sections = await getPublishedHomepageSections();
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ type: 'HERO', titleEn: 'Published' });
  });

  it('orders sections by position and resolves a HERO section fully', async () => {
    await db.homepageSection.create({
      data: {
        type: 'BANNER',
        position: 1,
        enabled: true,
        config: { titleAr: 'ب', titleEn: 'Second' },
      },
    });
    await db.homepageSection.create({
      data: {
        type: 'HERO',
        position: 0,
        enabled: true,
        config: {
          titleAr: 'مرحبا',
          titleEn: 'Welcome',
          ctaLabelEn: 'Shop now',
          ctaHref: '/c/cars',
        },
      },
    });

    const sections = await getPublishedHomepageSections('en');
    expect(sections.map((s) => s.type)).toEqual(['HERO', 'BANNER']);
    expect(sections[0]).toMatchObject({
      titleEn: 'Welcome',
      ctaLabelEn: 'Shop now',
      ctaHref: '/c/cars',
    });
  });

  it('skips a section with a config that fails its type schema, logging rather than throwing', async () => {
    await db.homepageSection.create({
      data: {
        type: 'HERO',
        position: 0,
        enabled: true,
        config: { titleAr: '' }, // missing titleEn, empty titleAr — invalid
      },
    });
    await db.homepageSection.create({
      data: {
        type: 'HERO',
        position: 1,
        enabled: true,
        config: { titleAr: 'صالح', titleEn: 'Valid' },
      },
    });

    const sections = await getPublishedHomepageSections();
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ titleEn: 'Valid' });
  });

  it('resolves FEATURED_PRODUCTS from real, published catalog products in curated order', async () => {
    const category = await createCategory({ slug: 'gear', nameAr: 'معدات', nameEn: 'Gear' });
    const productA = await createProduct({
      product: { slug: 'gear-a', nameAr: 'أ', nameEn: 'A', categoryId: category.id },
      variants: [{ sku: 'GEAR-A', priceMinor: 1000 }],
    }).then((p) => publishProduct(p.id));
    const productB = await createProduct({
      product: { slug: 'gear-b', nameAr: 'ب', nameEn: 'B', categoryId: category.id },
      variants: [{ sku: 'GEAR-B', priceMinor: 2000 }],
    }).then((p) => publishProduct(p.id));

    await db.homepageSection.create({
      data: {
        type: 'FEATURED_PRODUCTS',
        position: 0,
        enabled: true,
        config: { productIds: [productB.id, productA.id] },
      },
    });

    const sections = await getPublishedHomepageSections();
    expect(sections).toHaveLength(1);
    const section = sections[0]!;
    if (section.type !== 'FEATURED_PRODUCTS') throw new Error('expected FEATURED_PRODUCTS');
    expect(section.products.map((p) => p.slug)).toEqual(['gear-b', 'gear-a']);
  });

  it('filters ACTIVE_OFFERS to products that are actually on sale right now', async () => {
    const category = await createCategory({ slug: 'deals', nameAr: 'عروض', nameEn: 'Deals' });
    const onSale = await createProduct({
      product: { slug: 'on-sale', nameAr: 'بخصم', nameEn: 'On sale', categoryId: category.id },
      variants: [{ sku: 'SALE-1', priceMinor: 2000, salePriceMinor: 1000 }],
    }).then((p) => publishProduct(p.id));
    const staleCuration = await createProduct({
      product: {
        slug: 'no-longer-on-sale',
        nameAr: 'انتهى',
        nameEn: 'No longer on sale',
        categoryId: category.id,
      },
      variants: [{ sku: 'SALE-2', priceMinor: 2000 }],
    }).then((p) => publishProduct(p.id));

    await db.homepageSection.create({
      data: {
        type: 'ACTIVE_OFFERS',
        position: 0,
        enabled: true,
        config: { productIds: [onSale.id, staleCuration.id] },
      },
    });

    const sections = await getPublishedHomepageSections();
    const section = sections[0]!;
    if (section.type !== 'ACTIVE_OFFERS') throw new Error('expected ACTIVE_OFFERS');
    expect(section.products.map((p) => p.slug)).toEqual(['on-sale']);
  });

  it('resolves TRUST_BLOCKS, falling back to a safe icon for an unrecognized name', async () => {
    await db.homepageSection.create({
      data: {
        type: 'TRUST_BLOCKS',
        position: 0,
        enabled: true,
        config: {
          items: [
            { icon: 'Truck', titleAr: 'شحن سريع', titleEn: 'Fast shipping' },
            { icon: 'NotARealIcon', titleAr: 'ضمان', titleEn: 'Warranty' },
          ],
        },
      },
    });

    const sections = await getPublishedHomepageSections();
    const section = sections[0]!;
    if (section.type !== 'TRUST_BLOCKS') throw new Error('expected TRUST_BLOCKS');
    expect(section.items[0]?.icon).toBe('Truck');
    expect(section.items[1]?.icon).toBe('BadgeCheck');
  });
});

describe('buildFallbackHomepageSections', () => {
  it('returns nothing when the store has nothing published, so the honest empty state stands', async () => {
    expect(await buildFallbackHomepageSections('en')).toEqual([]);
  });

  it('shows the store its own products when no homepage has been built', async () => {
    const category = await createCategory({ slug: 'fallback-cat', nameAr: 'فئة', nameEn: 'Cat' });
    const product = await createProduct({
      product: {
        slug: 'fallback-product',
        nameAr: 'منتج',
        nameEn: 'Fallback product',
        categoryId: category.id,
        status: 'DRAFT',
      },
      variants: [{ sku: 'FALLBACK-1', priceMinor: 10_000 }],
    });
    await publishProduct(product.id);

    const sections = await buildFallbackHomepageSections('en');

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ type: 'NEW_ARRIVALS', titleEn: 'Latest products' });
    expect((sections[0] as { products: { slug: string }[] }).products.map((p) => p.slug)).toEqual([
      'fallback-product',
    ]);
  });

  it('ignores a draft product — the fallback shows the storefront, not the admin', async () => {
    const category = await createCategory({ slug: 'draft-cat', nameAr: 'فئة', nameEn: 'Cat' });
    await createProduct({
      product: {
        slug: 'still-a-draft',
        nameAr: 'مسودة',
        nameEn: 'Still a draft',
        categoryId: category.id,
        status: 'DRAFT',
      },
      variants: [{ sku: 'DRAFT-1', priceMinor: 10_000 }],
    });

    expect(await buildFallbackHomepageSections('en')).toEqual([]);
  });

  it('adds a category grid only when there is more than one category to choose between', async () => {
    const first = await createCategory({ slug: 'cat-one', nameAr: 'واحد', nameEn: 'One' });
    const product = await createProduct({
      product: {
        slug: 'two-cat-product',
        nameAr: 'منتج',
        nameEn: 'Product',
        categoryId: first.id,
        status: 'DRAFT',
      },
      variants: [{ sku: 'TWO-CAT-1', priceMinor: 10_000 }],
    });
    await publishProduct(product.id);

    // One category: a grid of one repeats the header's own link.
    expect(await buildFallbackHomepageSections('en')).toHaveLength(1);

    await createCategory({ slug: 'cat-two', nameAr: 'اتنين', nameEn: 'Two' });
    const withTwo = await buildFallbackHomepageSections('en');

    expect(withTwo).toHaveLength(2);
    expect(withTwo[1]).toMatchObject({
      type: 'FEATURED_CATEGORIES',
      titleEn: 'Shop by category',
    });
  });

  it('is never used once a real section exists — the two are separate reads', async () => {
    await db.homepageSection.create({
      data: { type: 'HERO', position: 0, enabled: true, config: { titleAr: 'أ', titleEn: 'A' } },
    });

    // The configured read is what the page prefers; the fallback knows
    // nothing about it and stays a pure "what would we show instead".
    expect(await getPublishedHomepageSections('en')).toHaveLength(1);
  });
});
