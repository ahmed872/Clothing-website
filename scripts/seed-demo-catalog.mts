/**
 * Seeds the demo catalog: `scripts/data/demo-catalog.json` → the catalog domain.
 *
 * The data started life as the original Vite app's `cars.json`, but that
 * application no longer lives in this repository (it was archived to its own
 * repo when the rebuild was finished). The file is now the new app's own
 * demo fixture and nothing here reaches outside `scripts/`.
 *
 * Every car becomes: Category = "Cars" (created once), a Brand (created once
 * per distinct brand name), a Product, and that product's one required
 * default Variant — exactly the shape every other kind of product goes
 * through too. Nothing here is car-specific at the schema or service level;
 * what makes these "cars" is entirely the AttributeDefinition rows created
 * on the Cars category below.
 *
 * Run with: pnpm db:seed-demo-catalog
 *
 * Idempotent by refusal, not by silent skipping: if a "cars" category
 * already exists, the script stops immediately rather than risk a partial
 * double-import. Clear the catalog tables first (or point DATABASE_URL at a
 * fresh database) to re-run it.
 *
 * `.mts` (not `.ts`) for top-level await; `NODE_OPTIONS=--conditions=react-server`
 * (set in the `db:seed-demo-catalog` script) so `server-only` in `db.ts` resolves to
 * its no-op — Node's own condition mechanism, not a bundler trick, and the
 * exact same real-server context that condition is meant to describe: this
 * script only ever runs in Node, never a browser.
 *
 * ---------------------------------------------------------------------------
 * Field mapping (legacy key → new model), and the one documented gap
 * ---------------------------------------------------------------------------
 *   id           → dropped. It was the array index in the legacy JSON file,
 *                  not business data — nothing in the new schema references
 *                  it, and no field in the mapping list below needed it.
 *   name         → Product.nameEn, and Product.nameAr (see gap below)
 *   model        → not in the phase's explicit field list, but real data —
 *                  added as an extra Cars attribute (`model`, TEXT) rather
 *                  than dropped, so no source field is lost.
 *   brand        → Brand.nameEn / Brand.nameAr (see gap below), matched or
 *                  created once per distinct value, then Product.brandId
 *   year         → Cars attribute `year` (NUMBER)
 *   price        → Variant.priceMinor (source treated as SAR major units:
 *                  125000 → 12,500,000 halalas)
 *   fuelType     → Cars attribute `fuel_type` (SELECT)
 *   transmission → Cars attribute `transmission` (SELECT)
 *   engine       → Cars attribute `engine` (TEXT)
 *   mileage      → Cars attribute `mileage` (NUMBER, unit km)
 *   color        → Cars attribute `color` (TEXT — paint names are too varied
 *                  for a closed SELECT list)
 *   seating      → Cars attribute `seating` (NUMBER)
 *   description  → Product.descriptionEn / Product.descriptionAr (see gap)
 *   images       → MediaAsset (storageKey = the source URL — a real upload
 *                  pipeline is P04; referencing the existing URLs directly
 *                  is the "MediaAsset reference only when needed" P03 allows)
 *                  + ProductImage, first image marked primary
 *   featured     → Product.featured
 *
 *   GAP — no Arabic source content: the legacy data is English-only. nameAr,
 *   descriptionAr and every Brand's/attribute's Arabic label are *not*
 *   translations — they are the English source text copied verbatim,
 *   because inventing a translation would be fabricating data, not migrating
 *   it, and those columns are NOT NULL so leaving them empty isn't an option
 *   either. Flagged again in the summary this script prints; it belongs to a
 *   content/localization task outside P03's scope (domain, not editorial
 *   judgment).
 */

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
  createBrand,
  getBrandBySlug,
  createAttributeDefinition,
  createProduct,
  getProductBySlug,
  ensureUniqueSlug,
  generateSku,
} = await import('../src/modules/catalog/index.js');
const { db } = await import('../src/modules/core/index.js');

interface LegacyCar {
  id: number;
  name: string;
  brand: string;
  model: string;
  year: number;
  price: number;
  fuelType: string;
  transmission: string;
  engine: string;
  mileage: number;
  color: string;
  seating: number;
  description: string;
  images: string[];
  featured: boolean;
}

const LEGACY_CAR_FIELDS = [
  'id',
  'name',
  'brand',
  'model',
  'year',
  'price',
  'fuelType',
  'transmission',
  'engine',
  'mileage',
  'color',
  'seating',
  'description',
  'images',
  'featured',
] as const;

const dataPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'data/demo-catalog.json',
);

async function main() {
  const cars: LegacyCar[] = JSON.parse(readFileSync(dataPath, 'utf-8'));
  console.log(`Read ${cars.length} cars from ${path.relative(process.cwd(), dataPath)}`);

  // Fail loudly on a field the mapping above doesn't account for, rather
  // than silently dropping it — the phase's own instruction.
  for (const car of cars) {
    const unknown = Object.keys(car).filter(
      (key) => !(LEGACY_CAR_FIELDS as readonly string[]).includes(key),
    );
    if (unknown.length > 0) {
      throw new Error(
        `Car #${car.id} has unmapped field(s): ${unknown.join(', ')}. Stopping — see the mapping table at the top of this script.`,
      );
    }
  }

  const existingCars = await getCategoryBySlug('cars');
  if (existingCars) {
    console.error(
      'A "cars" category already exists — refusing to run again to avoid a partial double-import.',
    );
    console.error('Clear the catalog tables (or use a fresh database) and re-run.');
    process.exitCode = 1;
    return;
  }

  const category = await createCategory({ slug: 'cars', nameAr: 'Cars', nameEn: 'Cars' });
  console.log(`Created category: ${category.nameEn} (${category.id})`);

  const attributeDefs: {
    key: string;
    labelEn: string;
    type: 'TEXT' | 'NUMBER' | 'SELECT';
    unit?: string;
    allowedValues?: string[];
    displayOrder: number;
  }[] = [
    {
      key: 'fuel_type',
      labelEn: 'Fuel type',
      type: 'SELECT',
      allowedValues: ['Petrol', 'Diesel', 'Hybrid', 'Electric'],
      displayOrder: 1,
    },
    {
      key: 'transmission',
      labelEn: 'Transmission',
      type: 'SELECT',
      allowedValues: ['Automatic', 'Manual'],
      displayOrder: 2,
    },
    { key: 'engine', labelEn: 'Engine', type: 'TEXT', displayOrder: 3 },
    { key: 'mileage', labelEn: 'Mileage', type: 'NUMBER', unit: 'km', displayOrder: 4 },
    { key: 'seating', labelEn: 'Seating', type: 'NUMBER', displayOrder: 5 },
    { key: 'color', labelEn: 'Color', type: 'TEXT', displayOrder: 6 },
    { key: 'year', labelEn: 'Year', type: 'NUMBER', displayOrder: 7 },
    { key: 'model', labelEn: 'Model', type: 'TEXT', displayOrder: 8 },
  ];
  for (const def of attributeDefs) {
    await createAttributeDefinition({
      categoryId: category.id,
      key: def.key,
      labelAr: def.labelEn, // same documented gap as product/brand names
      labelEn: def.labelEn,
      type: def.type,
      unit: def.unit,
      allowedValues: def.allowedValues,
      required: true,
    });
  }
  console.log(`Created ${attributeDefs.length} attribute definitions on Cars`);

  const brandCache = new Map<string, string>(); // brand name -> Brand.id
  const mediaCache = new Map<string, string>(); // image URL -> MediaAsset.id
  let brandsCreated = 0;
  let productsCreated = 0;
  let mediaAssetsCreated = 0;
  let imagesCreated = 0;

  for (const car of cars) {
    let brandId = brandCache.get(car.brand);
    if (!brandId) {
      const slug = await ensureUniqueSlug(car.brand, async (candidate: string) =>
        Boolean(await getBrandBySlug(candidate)),
      );
      const brand = await createBrand({ slug, nameAr: car.brand, nameEn: car.brand });
      brandId = brand.id;
      brandCache.set(car.brand, brandId);
      brandsCreated += 1;
    }

    // `name` already includes the brand for every car but one ("Range Rover
    // Autobiography" under brand "Land Rover" — the marketing name and the
    // corporate brand differ, which does happen in this industry); prefixing
    // the brand unconditionally would give 11 of 12 products a redundant
    // slug like "audi-audi-a8".
    const slug = await ensureUniqueSlug(car.name, async (candidate: string) =>
      Boolean(await getProductBySlug(candidate)),
    );

    const product = await createProduct({
      product: {
        slug,
        nameAr: car.name,
        nameEn: car.name,
        descriptionAr: car.description,
        descriptionEn: car.description,
        categoryId: category.id,
        brandId,
        featured: car.featured,
        attributes: {
          fuel_type: car.fuelType,
          transmission: car.transmission,
          engine: car.engine,
          mileage: car.mileage,
          seating: car.seating,
          color: car.color,
          year: car.year,
          model: car.model,
        },
      },
      variants: [
        {
          sku: generateSku(car.brand, car.name, car.year),
          priceMinor: Math.round(car.price * 100),
          stockQuantity: 1,
        },
      ],
    });
    productsCreated += 1;

    // The legacy dataset reuses the same handful of stock photos across many
    // cars (and, in a couple of cases, twice within one car's own `images`
    // array) — 36 image references resolve to only 15 distinct URLs. A
    // `storageKey` is a real, unique identifier for the underlying asset, so
    // the same URL is the same MediaAsset everywhere it appears, not a fresh
    // row per reference; `@@unique([productId, mediaId])` also means each
    // product can only reference a given asset once, so a repeat within one
    // car's own list is de-duplicated too (first occurrence wins the
    // position/primary flag).
    const uniqueUrls = [...new Set(car.images)];

    for (const [index, url] of uniqueUrls.entries()) {
      let mediaId = mediaCache.get(url);
      if (!mediaId) {
        const media = await db.mediaAsset.create({
          data: {
            storageKey: url,
            mime: 'image/jpeg',
            // Real dimensions/size require fetching or processing the
            // asset, which is P04's job (full media implementation), not
            // this reference-only migration's.
            sizeBytes: 0,
            altAr: car.name,
            altEn: car.name,
          },
        });
        mediaId = media.id;
        mediaCache.set(url, mediaId);
        mediaAssetsCreated += 1;
      }
      await db.productImage.create({
        data: { productId: product.id, mediaId, position: index, isPrimary: index === 0 },
      });
      imagesCreated += 1;
    }
  }

  console.log('\n--- Migration summary ---');
  console.log(`Categories created: 1 (Cars)`);
  console.log(`Attribute definitions created: ${attributeDefs.length}`);
  console.log(`Brands created: ${brandsCreated}`);
  console.log(`Products created: ${productsCreated}`);
  console.log(`Default variants created: ${productsCreated} (one per product)`);
  console.log(`Media assets created (deduplicated by URL): ${mediaAssetsCreated}`);
  console.log(`Product image links created: ${imagesCreated}`);
  console.log(
    "\nKnown gap: nameAr/descriptionAr (products), nameAr (brands) and every attribute's " +
      'labelAr are the English source text, not a translation — see the docstring at the ' +
      'top of this file. Everything else maps 1:1 with no data loss.',
  );
}

await main();
await db.$disconnect();
