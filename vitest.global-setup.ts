import { execSync } from 'node:child_process';

/**
 * Runs once before the whole test run (not per test file): applies pending
 * migrations to the test database so catalog service tests never run against
 * a schema that doesn't match `prisma/schema.prisma` yet.
 *
 * `NODE_ENV=test` makes `prisma.config.ts` load `.env.test` itself, so this
 * doesn't need its own dotenv parsing. `migrate deploy` is idempotent — a
 * schema that's already current is a fast no-op, so this is safe to run on
 * every `pnpm test`, locally and in CI, rather than requiring a manual step.
 */
export default function setup(): void {
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' },
  });
}
