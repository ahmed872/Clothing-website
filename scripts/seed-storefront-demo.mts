/**
 * Demo storefront content, on top of the catalog `db:seed-demo-catalog`
 * created: publishes every demo product, puts one on sale, writes the store's
 * settings row (only if there is none yet) and builds the homepage.
 *
 * Product writes go through the catalog's services (`publishProduct`);
 * `StoreSettings`, `HomepageSection` and the sale price are direct Prisma
 * writes, as they were before this became a clothing store — the admin has
 * its own screens for all three, and a seed that fills them in once does not
 * need a second write path.
 *
 * Run with: pnpm db:seed-storefront-demo
 *
 * Re-runnable: publishing and the sale are re-applied, the settings row is
 * left alone once it exists, and the homepage sections are reset and
 * recreated each run — this is demo content, not something an admin wrote.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env', quiet: true });

const { getCategoryBySlug, getProductBySlug, publishProduct } =
  await import('../src/modules/catalog/index.js');
const { db } = await import('../src/modules/core/index.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog: { categories: { slug: string }[]; products: { slug: string }[] } = JSON.parse(
  readFileSync(path.join(here, 'data/demo-catalog.json'), 'utf-8'),
);

/** The one demo product on sale, and by how much. */
const SALE_PRODUCT_SLUG = 'slim-fit-jeans';
const SALE_PERCENT = 20;
const HERO_LINK = '/c/women';

// ---------------------------------------------------------------------------
// 1. Publish every demo product
// ---------------------------------------------------------------------------

const categoryIds: string[] = [];
for (const { slug } of catalog.categories) {
  const category = await getCategoryBySlug(slug);
  if (!category) {
    console.error(`No "${slug}" category found — run \`pnpm db:seed-demo-catalog\` first.`);
    process.exit(1);
  }
  categoryIds.push(category.id);
}

let published = 0;
for (const { slug } of catalog.products) {
  const product = await getProductBySlug(slug);
  if (!product) {
    console.warn(`  ! product "${slug}" not found — skipping`);
    continue;
  }
  if (product.status !== 'PUBLISHED') {
    await publishProduct(product.id);
    published += 1;
  }
}
console.log(`✓ ${published} products newly published`);

// ---------------------------------------------------------------------------
// 2. One real discount, on every size and colour of one product
// ---------------------------------------------------------------------------

const saleProduct = await getProductBySlug(SALE_PRODUCT_SLUG);
if (saleProduct) {
  const variants = await db.variant.findMany({ where: { productId: saleProduct.id } });
  for (const variant of variants) {
    await db.variant.update({
      where: { id: variant.id },
      data: {
        compareAtMinor: variant.priceMinor,
        salePriceMinor: Math.round((variant.priceMinor * (100 - SALE_PERCENT)) / 100),
        saleStartsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        saleEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }
  console.log(`✓ ${saleProduct.nameEn}: ${SALE_PERCENT}% off for 30 days`);
}

// ---------------------------------------------------------------------------
// 3. StoreSettings — single row, created only if none exists yet. The name
//    and contact details are placeholders the owner replaces in Settings.
// ---------------------------------------------------------------------------

const existingSettings = await db.storeSettings.findFirst();
if (!existingSettings) {
  await db.storeSettings.create({
    data: {
      storeNameAr: 'متجر الملابس',
      storeNameEn: 'Clothing Store',
      currency: 'SAR',
      defaultLocale: 'AR',
      contact: { phone: '+966500000000', email: 'hello@example.com' },
      socialLinks: {},
      seoDefaults: {
        titleAr: 'متجر الملابس — أزياء نسائية ورجالية وللأطفال',
        titleEn: 'Clothing Store — Women’s, Men’s and Kids’ Fashion',
        descriptionAr: 'عبايات وأثواب وفساتين وملابس يومية للعائلة كلها، مع توصيل لباب البيت.',
        descriptionEn:
          'Abayas, thobes, dresses and everyday clothes for the whole family, delivered to your door.',
      },
      whatsappNumber: '+966500000000',
    },
  });
  console.log('✓ StoreSettings row created');
} else {
  console.log('  StoreSettings row already exists — left unchanged');
}

// ---------------------------------------------------------------------------
// 4. HomepageSections — reset and recreated each run (demo content).
// ---------------------------------------------------------------------------

await db.homepageSection.deleteMany();

const heroImage = await db.mediaAsset.findUnique({ where: { storageKey: 'media/demo/hero.webp' } });

const featuredProducts = await db.product.findMany({
  where: { featured: true, status: 'PUBLISHED' },
  orderBy: { createdAt: 'asc' },
  select: { id: true },
  take: 8,
});

let position = 0;
await db.homepageSection.create({
  data: {
    type: 'HERO',
    position: position++,
    enabled: true,
    config: {
      titleAr: 'تشكيلة الموسم الجديد',
      titleEn: 'The New Season Collection',
      subtitleAr: 'عبايات وأثواب وفساتين وقطع يومية للعائلة كلها.',
      subtitleEn: 'Abayas, thobes, dresses and everyday pieces for the whole family.',
      ctaLabelAr: 'تسوّق الآن',
      ctaLabelEn: 'Shop Now',
      ctaHref: HERO_LINK,
      ...(heroImage ? { imageMediaId: heroImage.id } : {}),
    },
  },
});

await db.homepageSection.create({
  data: {
    type: 'FEATURED_CATEGORIES',
    position: position++,
    enabled: true,
    config: { titleAr: 'تسوّق حسب الفئة', titleEn: 'Shop by Category', categoryIds },
  },
});

if (featuredProducts.length > 0) {
  await db.homepageSection.create({
    data: {
      type: 'FEATURED_PRODUCTS',
      position: position++,
      enabled: true,
      config: {
        titleAr: 'الأكثر طلبًا',
        titleEn: 'Most Loved',
        productIds: featuredProducts.map((p) => p.id),
      },
    },
  });
}

if (saleProduct) {
  await db.homepageSection.create({
    data: {
      type: 'ACTIVE_OFFERS',
      position: position++,
      enabled: true,
      config: { titleAr: 'عروض حالية', titleEn: 'On Sale Now', productIds: [saleProduct.id] },
    },
  });
}

await db.homepageSection.create({
  data: {
    type: 'NEW_ARRIVALS',
    position: position++,
    enabled: true,
    config: { titleAr: 'وصل حديثًا', titleEn: 'New Arrivals', limit: 8 },
  },
});

await db.homepageSection.create({
  data: {
    type: 'TRUST_BLOCKS',
    position: position++,
    enabled: true,
    config: {
      items: [
        {
          icon: 'Truck',
          titleAr: 'توصيل سريع',
          titleEn: 'Fast Delivery',
          descriptionAr: 'نوصّل طلبك إلى باب بيتك في جميع أنحاء المملكة.',
          descriptionEn: 'Delivered to your door anywhere in the Kingdom.',
        },
        {
          icon: 'RotateCcw',
          titleAr: 'استبدال سهل',
          titleEn: 'Easy Exchanges',
          descriptionAr: 'المقاس ما ضبط؟ استبدله خلال 14 يومًا.',
          descriptionEn: 'Wrong size? Exchange it within 14 days.',
        },
        {
          icon: 'Lock',
          titleAr: 'دفع آمن',
          titleEn: 'Secure Payment',
          descriptionAr: 'بياناتك محمية في كل خطوة من الدفع.',
          descriptionEn: 'Your details are protected at every step of checkout.',
        },
        {
          icon: 'Headphones',
          titleAr: 'نساعدك تختار',
          titleEn: 'Help Choosing',
          descriptionAr: 'فريقنا يساعدك في اختيار المقاس المناسب.',
          descriptionEn: 'Our team will help you find the right size.',
        },
      ],
    },
  },
});

await db.homepageSection.create({
  data: {
    type: 'TESTIMONIALS',
    position: position++,
    enabled: true,
    config: {
      titleAr: 'ماذا يقول عملاؤنا',
      titleEn: 'What Our Customers Say',
      items: [
        {
          authorName: 'Noura S.',
          authorTitleAr: 'الرياض',
          authorTitleEn: 'Riyadh',
          quoteAr: 'العباية وصلت بسرعة وخامتها أجمل من الصور، والمقاس مضبوط تمامًا.',
          quoteEn:
            'The abaya arrived quickly, the fabric is even nicer than the photos, and the size was spot on.',
          rating: 5,
        },
        {
          authorName: 'Faisal A.',
          authorTitleAr: 'جدة',
          authorTitleEn: 'Jeddah',
          quoteAr: 'ثوب مريح وخياطته ممتازة، وطلبت مقاسًا ثانيًا لأخي.',
          quoteEn:
            'A comfortable thobe with excellent stitching — I ordered a second one for my brother.',
          rating: 5,
        },
        {
          authorName: 'Reem K.',
          authorTitleAr: 'الدمام',
          authorTitleEn: 'Dammam',
          quoteAr: 'ملابس الأطفال ناعمة وتتحمّل الغسيل، واستبدلت مقاسًا بسهولة.',
          quoteEn: 'The kids’ clothes are soft and wash well, and exchanging a size was easy.',
          rating: 4,
        },
      ],
    },
  },
});

console.log(`✓ ${position} HomepageSection rows seeded`);
console.log('\nDone.');

await db.$disconnect();
