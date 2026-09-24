import type { Role } from '@generated/prisma';

/**
 * `@auth/core` itself is not a direct dependency here (pnpm nests it inside
 * `next-auth`'s own `node_modules`, unreachable from `src`), so augmenting
 * `"@auth/core/types"` directly resolves to a disconnected phantom module
 * rather than the real one Auth.js uses internally — confirmed by trying it
 * and watching `tsc` still report the base (unaugmented) types everywhere.
 * `next-auth` and `next-auth/jwt` are real direct-dependency subpaths, so
 * augmenting those is what actually reaches the types Auth.js's own
 * `authorize`/`jwt`/`session` callbacks are declared against.
 */
declare module 'next-auth' {
  interface User {
    role?: Role;
    /** Opaque pointer into the `Session` DB table — see `session.service.ts`.
     * Only ever present transiently, on the object `authorize()` returns; it
     * is read once by the `jwt` callback and never re-exposed on `Session`. */
    dbSessionToken?: string;
  }

  interface Session {
    user?: User;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: Role;
    dbSessionToken?: string;
  }
}
