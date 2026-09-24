import path from 'node:path';
import { createRequire } from 'node:module';

import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

// Catalog service tests (P03) hit a real PostgreSQL database, unlike P01's
// pure-function tests — see docs/environments.md for the three-environment
// contract. `.env.test` is gitignored and loaded here (not left to the OS
// environment) so `pnpm test` works the same on a laptop and in CI, where the
// job already exports DATABASE_URL and this call harmlessly finds no file.
const testEnv = loadDotenv({ path: '.env.test', quiet: true }).parsed ?? {};

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['legacy/**', 'node_modules/**', '.next/**'],
    // Catalog test files share one real Postgres database (truncated in
    // `beforeEach`, not per-file-isolated) — running files in parallel means
    // one file's reset can wipe rows a concurrently-running file is mid-test
    // on. Pure-function test files pay a small, unnecessary cost for this,
    // but the suite is small enough that serial execution is still fast.
    fileParallelism: false,
    // Injected directly into the test process regardless of pool (threads vs.
    // forks): a plain `process.env` mutation above is not guaranteed to reach
    // worker processes, but Vitest's own `env` option is.
    env: testEnv,
    globalSetup: ['./vitest.global-setup.ts'],
    // By default Vite/Vitest treats node_modules packages as SSR-external,
    // handing them to Node's own resolver directly — which bypasses
    // `resolve.alias` entirely for anything `next-auth` imports internally.
    // Forcing it through Vite's own resolve pipeline is what makes the
    // `next/server` alias below actually apply.
    server: { deps: { inline: ['next-auth'] } },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@generated': path.resolve(import.meta.dirname, 'generated'),
      // `server-only`'s package.json resolves to its throwing `index.js`
      // (the client-bundle guard) unless the bundler sets the `react-server`
      // export condition, which is a Next.js/webpack-specific condition
      // Vitest never sets — so under plain Vitest it always throws, even
      // though a Vitest test genuinely does run in a server-only context
      // (Node, never a browser). Aliasing straight to the package's own
      // `empty.js` (the no-op it uses *for* the react-server condition) says
      // exactly that. This is test-resolution only — Next's real client
      // build is a separate config and still fails the moment a client
      // component reaches `db.ts`, per docs/environments.md.
      'server-only': path.resolve(import.meta.dirname, 'node_modules/server-only/empty.js'),
      // `next-auth`'s own code does `import { NextRequest } from "next/server"`
      // (no extension) — resolvable by Next's own bundler, but Vitest/Vite's
      // resolver can't find it as a bare specifier under this pnpm layout
      // ("Did you mean to import next/server.js?"). `identity/nav-config.ts`
      // (a `src/lib` file, so it must go through the `@/modules/identity`
      // barrel, not a deep import — see `no-restricted-imports`) only needs
      // `roleHasPermission`, but importing anything from that barrel still
      // evaluates `auth.ts` under Vite/Vitest's eager ESM execution (no
      // production tree-shaking at test time), so this has to resolve for
      // any identity-barrel test to run at all, not just next-auth's own.
      'next/server': require.resolve('next/server.js'),
    },
  },
});
