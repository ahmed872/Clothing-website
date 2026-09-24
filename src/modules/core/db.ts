import 'server-only';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@generated/prisma';

import { serverEnv } from './env';

/**
 * The single database client for the platform.
 *
 * Cached on `globalThis` in development because Next.js hot-reloads modules on
 * every edit, and a fresh PrismaClient per reload exhausts the connection pool
 * within minutes.
 *
 * Prisma 7 connects through a driver adapter rather than an embedded engine,
 * so the connection string is passed explicitly from the validated
 * `serverEnv()` value — no module reads `process.env.DATABASE_URL` directly.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const env = serverEnv();
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const db: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
