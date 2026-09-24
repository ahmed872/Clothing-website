/**
 * Seeds the demo clothing catalog: `scripts/data/demo-catalog.json` → the
 * catalog domain.
 *
 * What it creates, all through the catalog's own services:
 *   - the categories (Women, Men, Kids), each with the clothing attribute
 *     definitions (material, fit) marked filterable;
 *   - the brands;
 *   - every product as a DRAFT, with a Color × Size option matrix and one
 *     variant per combination — price, stock and SKU on the variant, the
 *     same shape the admin's own product form produces;
 *   - one image per colour, uploaded from `scripts/data/demo-images/`
 *     through whichever storage provider `STORAGE_PROVIDER` configures
 *     (local disk or S3), plus the homepage hero image.
 *
 * `db:seed-storefront-demo` then publishes the products and builds the
 * homepage around them.
 *
 * Run with: pnpm db:seed-demo-catalog
 *
 * Idempotent by refusal, not by silent skipping: if any demo category
 * already exists, the script stops before writing anything rather than risk
 * a partial double-import. Clear the catalog tables first (or point
 * DATABASE_URL at a fresh database) to re-run it.
 *
 * `.mts` (not `.ts`) for top-level await; `NODE_OPTIONS=--conditions=react-server`
 * (set in the `db:seed-demo-catalog` script) so `server-only` in `db.ts` resolves to
 * its no-op — Node's own condition mechanism, not a bundler trick, and the
 * exact same real-server context that condition is meant to describe: this
 * script only ever runs in Node, never a browser.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { config as loadDotenv } from 'dotenv';

// Must run before any catalog/core module is imported: `db.ts` reads
// `process.env.DATABASE_URL` at module-evaluation time, and a static
// top-level `import` would be hoisted ahead of this call.
loadDotenv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env', quiet: true });

const {
  createCategory,
  getCategoryBySlug,
  updateCategory,
  createBrand,
  createAttributeDefinition,
  createProduct,
  generateSku,
} = await import('../src/modules/catalog/index.js');
const { db } = await import('../src/modules/core/index.js');
const { getStorageProvider } = await import('../src/modules/media/provider-factory.js');
const { sniffImage } = await import('../src/modules/media/validation.js');

interface Localized {
  en: string;
  ar: string;
}

interface DemoColor extends Localized {
  hex: string;
}

interface DemoProduct {
  slug: string;
  skuPrefix: string;
  category: string;
  brand: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  featured: boolean;
  attributes: Record<string, string>;
  price: number;
  garment: string;
  sizes: string;
  stockBySize?: Record<string, number>;
  colors: DemoColor[];
}

interface DemoCatalog {
  categories: {
    slug: string;
    nameAr: string;
    nameEn: string;
    descriptionAr: string;
    descriptionEn: string;
    seoTitleAr: string;
    seoTitleEn: string;
    seoDescriptionAr: string;
    seoDescriptionEn: string;
    /** `<product slug>-<colour slug>`: whose image the category card shows. */
    image: string;
  }[];
  attributes: {
    key: string;
    labelAr: string;
    labelEn: string;
    type: 'SELECT';
    allowedValues: string[];
    required: boolean;
    filterable: boolean;
  }[];
  brands: { slug: string; nameAr: string; nameEn: string }[];
  sizeSets: Record<string, Localized[]>;
  products: DemoProduct[];
}

const PRODUCT_FIELDS = [
  'slug',
  'skuPrefix',
  'category',
  'brand',
  'nameAr',
  'nameEn',
  'descriptionAr',
  'descriptionEn',
  'featured',
  'attributes',
  'price',
  'garment',
  'sizes',
  'stockBySize',
  'colors',
];

/** Units per variant unless `stockBySize` says otherwise. */
const DEFAULT_STOCK = 12;
/** At or below this, the storefront says "only a few left". */
const LOW_STOCK_THRESHOLD = 3;
/** Where the uploaded demo files live in storage — `seed-storefront-demo`
 * finds the hero image again at `media/demo/hero.webp`. */
const DEMO_MEDIA_PREFIX = 'media/demo/';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(here, 'data/demo-catalog.json');
const imagesDir = path.join(here, 'data/demo-images');

const imageKey = (productSlug: string, color: Localized) =>
  `${productSlug}-${color.en.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

/** Fails before any write, naming every problem, rather than halfway through. */
function validate(catalog: DemoCatalog): void {
  const problems: string[] = [];
  const categories = new Set(catalog.categories.map((c) => c.slug));
  const brands = new Set(catalog.brands.map((b) => b.slug));
  const attributeKeys = new Set(catalog.attributes.map((a) => a.key));

  for (const product of catalog.products) {
    const where = `Product "${product.slug}"`;
    const unknown = Object.keys(product).filter((key) => !PRODUCT_FIELDS.includes(key));
    if (unknown.length > 0) problems.push(`${where} has unmapped field(s): ${unknown.join(', ')}`);
    if (!categories.has(product.category))
      problems.push(`${where}: unknown category ${product.category}`);
    if (!brands.has(product.brand)) problems.push(`${where}: unknown brand ${product.brand}`);
    if (!catalog.sizeSets[product.sizes])
      problems.push(`${where}: unknown size set ${product.sizes}`);
    for (const key of Object.keys(product.attributes)) {
      if (!attributeKeys.has(key)) problems.push(`${where}: unknown attribute ${key}`);
    }
    for (const color of product.colors) {
      try {
        readFileSync(path.join(imagesDir, `${imageKey(product.slug, color)}.webp`));
      } catch {
        problems.push(`${where}: no image for ${color.en} — run \`pnpm demo:images\``);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`demo-catalog.json is not valid:\n  - ${problems.join('\n  - ')}`);
  }
}

/** Uploads one file from `demo-images/` and records it as a MediaAsset. */
async function uploadImage(file: string, altAr: string, altEn: string): Promise<string> {
  const provider = getStorageProvider();
  const buffer = readFileSync(path.join(imagesDir, file));
  const sniffed = await sniffImage(buffer);
  if (!sniffed) throw new Error(`${file} is not a valid JPEG, PNG or WebP image`);

  // Same bytes, same asset — the platform's content-hash rule
  // (`confirmUpload`, `migrate-media`), and `contentHash` is unique.
  const contentHash = createHash('sha256').update(buffer).digest('hex');
  const existing = await db.mediaAsset.findUnique({ where: { contentHash } });
  if (existing) return existing.id;

  const storageKey = `${DEMO_MEDIA_PREFIX}${file}`;
  await provider.putObjectBuffer(storageKey, buffer, sniffed.mime);
  const asset = await db.mediaAsset.create({
    data: {
      provider: provider.name,
      storageKey,
      contentHash,
      mime: sniffed.mime,
      sizeBytes: buffer.byteLength,
      width: sniffed.width,
      height: sniffed.height,
      altAr,
      altEn,
    },
  });
  return asset.id;
}

async function main() {
  const catalog: DemoCatalog = JSON.parse(readFileSync(dataPath, 'utf-8'));
  console.log(
    `Read ${catalog.products.length} products from ${path.relative(process.cwd(), dataPath)}`,
  );
  validate(catalog);

  for (const category of catalog.categories) {
    if (await getCategoryBySlug(category.slug)) {
      console.error(
        `A "${category.slug}" category already exists — refusing to run again to avoid a partial double-import.`,
      );
      console.error('Clear the catalog tables (or use a fresh database) and re-run.');
      process.exitCode = 1;
      return;
    }
  }

  // Categories, each carrying the clothing attributes.
  const categoryIds = new Map<string, string>();
  for (const [position, input] of catalog.categories.entries()) {
    const category = await createCategory({
      slug: input.slug,
      nameAr: input.nameAr,
      nameEn: input.nameEn,
      descriptionAr: input.descriptionAr,
      descriptionEn: input.descriptionEn,
      seoTitleAr: input.seoTitleAr,
      seoTitleEn: input.seoTitleEn,
      seoDescriptionAr: input.seoDescriptionAr,
      seoDescriptionEn: input.seoDescriptionEn,
      position,
    });
    categoryIds.set(input.slug, category.id);
    for (const [displayOrder, attribute] of catalog.attributes.entries()) {
      await createAttributeDefinition({ categoryId: category.id, ...attribute, displayOrder });
    }
  }
  console.log(`Created ${catalog.categories.length} categories with their attributes`);

  const brandIds = new Map<string, string>();
  for (const input of catalog.brands) {
    const brand = await createBrand(input);
    brandIds.set(input.slug, brand.id);
  }
  console.log(`Created ${catalog.brands.length} brands`);

  const mediaIds = new Map<string, string>(); // image key -> MediaAsset.id
  let variantsCreated = 0;

  for (const product of catalog.products) {
    const sizes = catalog.sizeSets[product.sizes]!;
    const variants = product.colors.flatMap((color) =>
      sizes.map((size) => ({
        sku: generateSku(product.skuPrefix, color.en, size.en),
        priceMinor: Math.round(product.price * 100),
        stockQuantity: product.stockBySize?.[size.en] ?? DEFAULT_STOCK,
        lowStockThreshold: LOW_STOCK_THRESHOLD,
        optionValues: [
          { optionNameEn: 'Color', valueEn: color.en },
          { optionNameEn: 'Size', valueEn: size.en },
        ],
      })),
    );

    const created = await createProduct({
      product: {
        slug: product.slug,
        nameAr: product.nameAr,
        nameEn: product.nameEn,
        descriptionAr: product.descriptionAr,
        descriptionEn: product.descriptionEn,
        categoryId: categoryIds.get(product.category)!,
        brandId: brandIds.get(product.brand)!,
        featured: product.featured,
        attributes: product.attributes,
      },
      options: [
        {
          nameAr: 'اللون',
          nameEn: 'Color',
          values: product.colors.map((c) => ({ valueAr: c.ar, valueEn: c.en })),
        },
        {
          nameAr: 'المقاس',
          nameEn: 'Size',
          values: sizes.map((s) => ({ valueAr: s.ar, valueEn: s.en })),
        },
      ],
      // `position` in list order, so the first colour in its first size is
      // the variant the product page opens on.
      variants: variants.map((variant, position) => ({ ...variant, position })),
    });
    variantsCreated += created.variants.length;

    for (const [position, color] of product.colors.entries()) {
      const key = imageKey(product.slug, color);
      const mediaId = await uploadImage(
        `${key}.webp`,
        `${product.nameAr} — ${color.ar}`,
        `${product.nameEn} — ${color.en}`,
      );
      mediaIds.set(key, mediaId);
      await db.productImage.create({
        data: { productId: created.id, mediaId, position, isPrimary: position === 0 },
      });
    }
  }
  console.log(`Created ${catalog.products.length} products, ${variantsCreated} variants`);

  for (const category of catalog.categories) {
    const imageMediaId = mediaIds.get(category.image);
    if (imageMediaId) await updateCategory(categoryIds.get(category.slug)!, { imageMediaId });
  }

  await uploadImage(
    'hero.webp',
    'ثوب وعباية وفستان أطفال معلّقة على علّاقة ملابس',
    'A thobe, an abaya and a girls’ dress hanging on a clothes rail',
  );
  console.log(
    `Uploaded ${mediaIds.size + 1} images via the "${getStorageProvider().name}" provider`,
  );
  console.log('\nDone. Next: pnpm db:seed-storefront-demo (publishes and builds the homepage).');
}

await main();
await db.$disconnect();
