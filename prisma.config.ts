import { config as loadDotenv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 no longer reads .env implicitly, and the CLI runs outside Next.js
// (which does its own loading). `.env.test` wins when NODE_ENV=test so the
// test database is never migrated with development credentials by accident.
loadDotenv({
  path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
  quiet: true,
});

/**
 * Prisma 7 reads connection URLs from here rather than from schema.prisma.
 *
 * Only one URL is configured. Managed providers that put a connection pooler
 * in front of PostgreSQL cannot run migrations through the pooler, so the
 * migration step sets `DATABASE_URL` to the direct connection string for the
 * duration of that command — see docs/environments.md.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
