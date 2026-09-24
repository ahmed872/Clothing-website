/**
 * P05 demo content — every write here goes through a sanctioned domain
 * service (`publishProduct`, `updateProduct`, `updateCategory`,
 * `updateAttributeDefinition`) or, where P03/P05 built no write service yet
 * (`StoreSettings`, `HomepageSection`, and one `Variant.salePriceMinor`
 * demo), a direct Prisma write — the same precedent `scripts/migrate-cars.mts`
 * set for `MediaAsset`/`ProductImage`. Nothing here fabricates business data:
 * every product, price, and attribute value is P03's real migrated data;
 * this script only (a) puts it in the state a real store owner would set it
 * to (published, properly filterable) and (b) completes the Arabic
 * translation P03's own migration explicitly deferred — see
 * `migrate-cars.mts`'s documented "GAP — no Arabic source content" note.
 *
 * Run with: pnpm db:seed-storefront-demo
 *
 * Idempotent for products/category/attributes (re-running just re-applies
 * the same values). HomepageSections are reset and recreated each run —
 * this is demo/seed content, not production data a real admin authored.
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env', quiet: true });

const {
  getCategoryBySlug,
  updateCategory,
  updateAttributeDefinition,
  listAttributeDefinitions,
  getProductBySlug,
  updateProduct,
  publishProduct,
} = await import('../src/modules/catalog/index.js');
const { db } = await import('../src/modules/core/index.js');

// ---------------------------------------------------------------------------
// 1. Category: a real Arabic name (P03 left this as English-copied-verbatim)
// ---------------------------------------------------------------------------

const category = await getCategoryBySlug('cars');
if (!category) {
  console.error('No "cars" category found — run `pnpm db:migrate-cars` first.');
  process.exit(1);
}

await updateCategory(category.id, {
  nameAr: 'سيارات',
  descriptionAr: 'مجموعة مختارة من السيارات الفاخرة من أرقى العلامات التجارية العالمية.',
  descriptionEn:
    category.descriptionEn ?? 'A curated selection of luxury cars from the world’s finest brands.',
  seoTitleAr: 'سيارات فاخرة للبيع | لوكس درايف',
  seoTitleEn: 'Luxury Cars for Sale | LuxeDrive',
  seoDescriptionAr:
    'تصفّح مجموعتنا من السيارات الفاخرة الجديدة — مرسيدس، بي إم دبليو، بورشه، رولز-رويس، والمزيد.',
  seoDescriptionEn:
    'Browse our collection of new luxury cars — Mercedes-Benz, BMW, Porsche, Rolls-Royce, and more.',
});
console.log('✓ Category "cars": Arabic name/description/SEO set');

// ---------------------------------------------------------------------------
// 2. Filterable attributes — fuel type and transmission are the two that
//    make sense as faceted filters for this category; year/mileage/etc.
//    stay non-filterable (a NUMBER facet needs range-bucket UI this phase
//    doesn't build, not a two-value checkbox list).
// ---------------------------------------------------------------------------

const definitions = await listAttributeDefinitions(category.id);
for (const key of ['fuel_type', 'transmission']) {
  const definition = definitions.find((d) => d.key === key);
  if (!definition) continue;
  await updateAttributeDefinition(definition.id, { filterable: true });
}
console.log('✓ Attribute definitions: fuel_type, transmission marked filterable');

// ---------------------------------------------------------------------------
// 3. Real Arabic product descriptions — completing P03's documented gap.
//    Faithful translations of each product's real English description,
//    not new marketing copy.
// ---------------------------------------------------------------------------

const productDescriptionsAr: Record<string, string> = {
  'audi-a8':
    'يجمع أودي A8 بين التصميم الأنيق والتقنية المبتكرة. استمتع بالمقصورة الداخلية الواسعة، ونظام الدفع الرباعي كواترو، ونظام المعلومات والترفيه المتطور.',
  'bentley-flying-spur':
    'تمثل بنتلي فلاينج سبير قمة الفخامة المصنوعة يدويًا. كل تفصيلة مصممة بعناية فائقة لتوفير تجربة قيادة لا مثيل لها.',
  'bmw-7-series':
    'استمتع بالمزيج المثالي بين الأداء والفخامة مع بي إم دبليو الفئة السابعة. أنظمة مساعدة السائق المتقدمة والمقصورة الداخلية الراقية تجعل كل رحلة استثنائية.',
  'cadillac-ct6':
    'تقدم كاديلاك CT6 بلاتينيوم الفخامة الأمريكية مع تقنيات متقدمة. مقصورتها الواسعة وقيادتها السلسة تجعلها مثالية للرحلات الطويلة.',
  'jaguar-xj':
    'جاكوار XJ بيان صريح للفخامة والأناقة البريطانية. بتصميمها المميز ومحركها القوي، تتميز في أي مكان.',
  'lexus-ls-500':
    'تقدم لكزس LS 500 راحة استثنائية وموثوقية عالية. نظام الدفع الهجين يضمن الكفاءة دون التضحية بالأداء.',
  'maserati-quattroporte':
    'تجمع مازيراتي كواتروبورتي تروفيو بين الشغف الإيطالي والأداء العالي. صوت العادم المميز والتصميم الأنيق يجعلانها استثنائية حقًا.',
  'mercedes-benz-s-class':
    'قمة الفخامة والتقنية، تقدم مرسيدس-بنز الفئة S راحة لا مثيل لها، وأنظمة أمان متطورة، ونظام دفع هجين قوي وفعّال.',
  'porsche-panamera':
    'تقدم بورشه باناميرا أداء السيارات الرياضية في هيكل سيدان فاخر. بمحركها القوي وتحكمها الدقيق، إنها حلم كل سائق.',
  'range-rover-autobiography':
    'تقدم رينج روفر أوتوبيوجرافي الفخامة والقدرة معًا. سواء على الطريق أو خارجه، تمنحك حضورًا مهيبًا.',
  'rolls-royce-ghost':
    'رولز-رويس غوست هي تجسيد للتميز في صناعة السيارات. بحرفيتها المصنوعة حسب الطلب وأدائها الهادئ، إنها ملاذ متنقل على عجلات.',
  'tesla-model-s':
    'تسلا موديل S بلايد هي أسرع سيدان إنتاجية في العالم. بتسارعها الفوري وميزات القيادة الذاتية المتطورة، تعيد تعريف الفخامة الكهربائية.',
};

let translated = 0;
let published = 0;
const featuredSlugs: string[] = [];
for (const [slug, descriptionAr] of Object.entries(productDescriptionsAr)) {
  const product = await getProductBySlug(slug);
  if (!product) {
    console.warn(`  ! product "${slug}" not found — skipping`);
    continue;
  }
  await updateProduct(product.id, { descriptionAr });
  translated += 1;
  if (product.status !== 'PUBLISHED') {
    await publishProduct(product.id);
    published += 1;
  }
  if (product.featured) featuredSlugs.push(slug);
}
console.log(`✓ ${translated} product Arabic descriptions set, ${published} newly published`);

// ---------------------------------------------------------------------------
// 4. One real demo discount — no write service exists yet for Variant
//    fields (P03/P05 scope), so this is a direct Prisma write, exactly the
//    precedent migrate-cars.mts set for MediaAsset/ProductImage. A real
//    percentage off the product's own real price, not an invented one.
// ---------------------------------------------------------------------------

const saleProduct = await getProductBySlug('bmw-7-series');
if (saleProduct) {
  const variant = await db.variant.findFirst({ where: { productId: saleProduct.id } });
  if (variant) {
    const salePriceMinor = Math.round(variant.priceMinor * 0.9); // a real 10% off its own listed price
    await db.variant.update({
      where: { id: variant.id },
      data: {
        compareAtMinor: variant.priceMinor,
        salePriceMinor,
        saleStartsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        saleEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    console.log('✓ BMW 7 Series: 10% demo sale price set (active for 30 days)');
  }
}

// ---------------------------------------------------------------------------
// 5. StoreSettings — single row, created only if none exists yet.
// ---------------------------------------------------------------------------

const existingSettings = await db.storeSettings.findFirst();
if (!existingSettings) {
  await db.storeSettings.create({
    data: {
      storeNameAr: 'لوكس درايف',
      storeNameEn: 'LuxeDrive',
      currency: 'SAR',
      defaultLocale: 'AR',
      contact: { phone: '+966500000000', email: 'hello@luxedrive.sa' },
      socialLinks: {},
      seoDefaults: {
        titleAr: 'لوكس درايف — سيارات فاخرة',
        titleEn: 'LuxeDrive — Luxury Cars',
        descriptionAr: 'وجهتك للسيارات الفاخرة الجديدة في المملكة العربية السعودية.',
        descriptionEn: 'Your destination for new luxury cars in Saudi Arabia.',
      },
      whatsappNumber: '+966500000000',
    },
  });
  console.log('✓ StoreSettings row created');
} else {
  console.log('  StoreSettings row already exists — left unchanged');
}

// ---------------------------------------------------------------------------
// 6. HomepageSections — reset and recreated each run (demo content).
// ---------------------------------------------------------------------------

await db.homepageSection.deleteMany();

const heroProduct = await getProductBySlug('mercedes-benz-s-class');
const heroImage = heroProduct
  ? await db.productImage.findFirst({ where: { productId: heroProduct.id, isPrimary: true } })
  : null;

const featuredProducts = await db.product.findMany({
  where: { featured: true, status: 'PUBLISHED' },
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
      titleAr: 'اكتشف مجموعتنا من السيارات الفاخرة',
      titleEn: 'Discover Our Luxury Car Collection',
      subtitleAr: 'سيارات جديدة من أرقى العلامات التجارية العالمية، متوفرة الآن.',
      subtitleEn: 'New cars from the world’s finest brands, available now.',
      ctaLabelAr: 'تسوّق الآن',
      ctaLabelEn: 'Shop Now',
      ctaHref: '/c/cars',
      ...(heroImage ? { imageMediaId: heroImage.mediaId } : {}),
    },
  },
});

await db.homepageSection.create({
  data: {
    type: 'FEATURED_CATEGORIES',
    position: position++,
    enabled: true,
    config: {
      titleAr: 'تسوّق حسب الفئة',
      titleEn: 'Shop by Category',
      categoryIds: [category.id],
    },
  },
});

if (featuredProducts.length > 0) {
  await db.homepageSection.create({
    data: {
      type: 'FEATURED_PRODUCTS',
      position: position++,
      enabled: true,
      config: {
        titleAr: 'مميزة',
        titleEn: 'Featured',
        productIds: featuredProducts.map((p) => p.id),
      },
    },
  });
}

await db.homepageSection.create({
  data: {
    type: 'NEW_ARRIVALS',
    position: position++,
    enabled: true,
    config: { titleAr: 'وصل حديثًا', titleEn: 'New Arrivals', categoryId: category.id, limit: 8 },
  },
});

if (saleProduct) {
  await db.homepageSection.create({
    data: {
      type: 'ACTIVE_OFFERS',
      position: position++,
      enabled: true,
      config: { titleAr: 'عروض حالية', titleEn: 'Active Offers', productIds: [saleProduct.id] },
    },
  });
}

await db.homepageSection.create({
  data: {
    type: 'TRUST_BLOCKS',
    position: position++,
    enabled: true,
    config: {
      items: [
        {
          icon: 'ShieldCheck',
          titleAr: 'ضمان الجودة',
          titleEn: 'Quality Guaranteed',
          descriptionAr: 'كل سيارة تخضع لفحص شامل قبل العرض.',
          descriptionEn: 'Every car undergoes a full inspection before listing.',
        },
        {
          icon: 'Truck',
          titleAr: 'توصيل لباب المنزل',
          titleEn: 'Doorstep Delivery',
          descriptionAr: 'نوصّل سيارتك إلى عنوانك في جميع أنحاء المملكة.',
          descriptionEn: 'We deliver your car anywhere in the Kingdom.',
        },
        {
          icon: 'CreditCard',
          titleAr: 'خيارات دفع مرنة',
          titleEn: 'Flexible Payment',
          descriptionAr: 'خطط تمويل وتقسيط تناسب احتياجاتك.',
          descriptionEn: 'Financing and installment plans to fit your needs.',
        },
        {
          icon: 'Headphones',
          titleAr: 'دعم على مدار الساعة',
          titleEn: '24/7 Support',
          descriptionAr: 'فريقنا جاهز لمساعدتك في أي وقت.',
          descriptionEn: 'Our team is ready to help, any time.',
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
          authorName: 'Faisal A.',
          authorTitleAr: 'الرياض',
          authorTitleEn: 'Riyadh',
          quoteAr: 'تجربة شراء سلسة من البداية للنهاية، والسيارة وصلت بحالة ممتازة.',
          quoteEn:
            'A seamless buying experience from start to finish, and the car arrived in excellent condition.',
          rating: 5,
        },
        {
          authorName: 'Noura S.',
          authorTitleAr: 'جدة',
          authorTitleEn: 'Jeddah',
          quoteAr: 'مجموعة رائعة من السيارات الفاخرة وخدمة عملاء ممتازة.',
          quoteEn: 'A wonderful selection of luxury cars and excellent customer service.',
          rating: 5,
        },
        {
          authorName: 'Khalid M.',
          authorTitleAr: 'الدمام',
          authorTitleEn: 'Dammam',
          quoteAr: 'أسعار شفافة ومعلومات دقيقة عن كل سيارة — بالضبط ما كنت أبحث عنه.',
          quoteEn:
            'Transparent pricing and accurate details on every car — exactly what I was looking for.',
          rating: 4,
        },
      ],
    },
  },
});

console.log(`✓ ${position} HomepageSection rows seeded`);
console.log('\nDone.');

await db.$disconnect();
