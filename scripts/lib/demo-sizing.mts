/**
 * Demo size charts (clothing P02): `demo-catalog.json`'s `sizeCharts`, each
 * demo product's `sizing` entry naming its garment type and chart → the
 * sizing domain, through `saveProductSizing` — the same validation and
 * ownership checks the admin's own editor goes through. Nothing here is a
 * rule: the charts are data, and the admin can edit or remove them.
 *
 * Shared by `seed-demo-catalog.mts` (a fresh catalog) and
 * `seed-demo-sizing.mts` (a catalog seeded before P02). Idempotent: a
 * product that already has sizing is left exactly as it is.
 */

export interface DemoSizing {
  garmentType: string;
  chart: string;
  pattern?: string;
}

export interface DemoSizingCatalog {
  products: { slug: string; sizing?: DemoSizing; colors: { en: string; hex: string }[] }[];
  sizeCharts: Record<string, Record<string, number>[]>;
}

import type { SizeChartInput } from '../../src/modules/sizing/index.js';

/** The two things it needs, typed from the modules themselves — passed in
 * because the caller decides when `DATABASE_URL` is loaded. */
interface Deps {
  db: (typeof import('../../src/modules/core/index.js'))['db'];
  saveProductSizing: (typeof import('../../src/modules/sizing/index.js'))['saveProductSizing'];
  getProductSizing: (typeof import('../../src/modules/sizing/index.js'))['getProductSizing'];
}

/** Clothing P04 — the colour option and a swatch per colour, from the demo
 * data's own hex codes, plus the pattern where the product has one. */
function fittingAppearance(
  entry: DemoSizingCatalog['products'][number],
  colorOption: { id: string; values: { id: string; valueEn: string }[] } | undefined,
) {
  if (!colorOption) return {};
  return {
    colorOptionId: colorOption.id,
    pattern: (entry.sizing?.pattern ?? '') as SizeChartInput['pattern'],
    swatches: colorOption.values.flatMap((value) => {
      const hex = entry.colors.find((c) => c.en === value.valueEn)?.hex;
      return hex ? [{ optionValueId: value.id, hex }] : [];
    }),
  };
}

export async function seedDemoSizing(
  catalog: DemoSizingCatalog,
  { db, saveProductSizing, getProductSizing }: Deps,
): Promise<{ created: number; updated: number; skipped: number; missing: string[] }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const missing: string[] = [];

  for (const entry of catalog.products) {
    if (!entry.sizing) continue;
    const product = await db.product.findUnique({
      where: { slug: entry.slug },
      select: {
        id: true,
        sizing: { select: { id: true } },
        options: {
          select: {
            id: true,
            nameEn: true,
            values: {
              select: { id: true, valueEn: true, position: true },
              orderBy: { position: 'asc' },
            },
          },
        },
      },
    });
    if (!product) {
      missing.push(entry.slug);
      continue;
    }
    const sizeOption = product.options.find((option) => option.nameEn === 'Size');
    const colorOption = product.options.find((option) => option.nameEn === 'Color');
    if (product.sizing) {
      // A chart from before P04 gets its colours once; anything already
      // set (by the admin, perhaps) is left alone.
      const current = await getProductSizing(product.id);
      if (current && !current.colorOption && colorOption) {
        await saveProductSizing(
          product.id,
          {
            garmentType: current.garmentType,
            sizeOptionId: current.sizeOption?.id ?? null,
            entries: current.entries.map((row) => ({
              optionValueId: row.optionValueId,
              measurements: Object.fromEntries(
                Object.entries(row.measurements).map(([k, v]) => [k, String(v)]),
              ),
            })),
            ...current.style,
            ...fittingAppearance(entry, colorOption),
          },
          { expectedUpdatedAt: current.updatedAt },
        );
        updated += 1;
      } else {
        skipped += 1;
      }
      continue;
    }
    const rows = catalog.sizeCharts[entry.sizing.chart];
    if (!sizeOption || !rows || rows.length !== sizeOption.values.length) {
      throw new Error(`Demo sizing for "${entry.slug}" does not match its sizes`);
    }
    await saveProductSizing(product.id, {
      // Checked against the closed list by the sizing schema on save.
      garmentType: entry.sizing.garmentType as SizeChartInput['garmentType'],
      sizeOptionId: sizeOption.id,
      // The chart lists sizes in the size set's own order, smallest first.
      entries: sizeOption.values.map((value, index) => ({
        optionValueId: value.id,
        measurements: Object.fromEntries(
          Object.entries(rows[index]!).map(([key, cm]) => [key, String(cm)]),
        ),
      })),
      ...fittingAppearance(entry, colorOption),
    });
    created += 1;
  }
  return { created, updated, skipped, missing };
}
