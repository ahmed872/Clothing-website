/**
 * Adds the demo size charts to a demo catalog seeded before clothing P02 —
 * `seed-demo-catalog.mts` does the same for a fresh one. Safe to run again:
 * products that already have sizing (the admin may have edited it) are left
 * alone.
 *
 * Run with: pnpm db:seed-demo-sizing
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { config as loadDotenv } from 'dotenv';

// Before any module that reads DATABASE_URL at evaluation time.
loadDotenv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env', quiet: true });

const { db } = await import('../src/modules/core/index.js');
const { saveProductSizing } = await import('../src/modules/sizing/index.js');
const { seedDemoSizing } = await import('./lib/demo-sizing.mjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(path.join(here, 'data/demo-catalog.json'), 'utf8'));

const result = await seedDemoSizing(catalog, {
  db,
  saveProductSizing,
});
console.log(
  `Demo sizing: ${result.created} created, ${result.skipped} already had sizing` +
    (result.missing.length > 0 ? `, not found: ${result.missing.join(', ')}` : ''),
);
await db.$disconnect();
