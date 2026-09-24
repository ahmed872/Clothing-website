/**
 * Database smoke check.
 *
 * Proves three things against a real PostgreSQL instance: the connection
 * string works, the migration has been applied, and the generated client can
 * query the schema. Run by CI after `prisma migrate deploy`.
 *
 * Plain JavaScript on purpose — it must run with nothing but Node and the
 * generated client, before any bundler or test runner is involved.
 */

import { config as loadDotenv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/index.js';

loadDotenv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env', quiet: true });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  const [{ version }] = await prisma.$queryRaw`SELECT version() AS version`;

  const tables = await prisma.$queryRaw`
    SELECT count(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;

  // `finished_at IS NOT NULL` matters: Postgres sorts NULL first in a DESC
  // order, so a migration attempt that started and failed before completing
  // — which leaves a row with no `finished_at` — would otherwise outrank
  // every migration that actually succeeded, no matter how long ago the
  // failed attempt was. Found by exactly that: a P10-era failed attempt
  // still sitting in this table made this check report a stale migration
  // name while the real latest one (P11's) had, in fact, applied.
  const migrations = await prisma.$queryRaw`
    SELECT migration_name, finished_at
    FROM _prisma_migrations
    WHERE finished_at IS NOT NULL
    ORDER BY finished_at DESC
    LIMIT 1
  `;

  // Exercise the typed client, not just raw SQL.
  const userCount = await prisma.user.count();
  const productCount = await prisma.product.count();

  console.log('connection    : ok');
  console.log('server        :', version.split(',')[0]);
  console.log('tables        :', tables[0].count);
  console.log('last migration:', migrations[0]?.migration_name ?? 'none');
  console.log('typed queries : users=%d products=%d', userCount, productCount);
  console.log('\nDatabase smoke check passed.');
} catch (error) {
  console.error('Database smoke check failed:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
