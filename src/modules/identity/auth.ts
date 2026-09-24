import 'server-only';

import type { Role } from '@generated/prisma';
import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

import { serverEnv } from '@/modules/core';

import { recordAuditEvent } from './audit.service';
import { getClientIp } from './request-ip';
import { ROLE_PERMISSIONS, isAdminRole } from './permissions';
import { getLoginRateLimiter } from './rate-limiter';
import {
  createDbSession,
  revokeDbSession,
  validateDbSession,
  SESSION_TTL_MS,
} from './session.service';
import { getUserById, touchLastLogin, verifyAdminCredentials } from './user.service';

/**
 * Auth.js v5 configuration — the admin area's one authentication entry
 * point. See `session.service.ts` for why this is a hybrid: Auth.js's own
 * JWT is the cookie/CSRF transport, but a DB session row is the real source
 * of truth for revocation, re-validated on every request inside the `jwt`
 * callback.
 *
 * `session: { strategy: 'jwt' }` rather than `'database'` — the schema's
 * `Session` model doesn't match Auth.js's canonical Adapter shape, and a
 * full custom Adapter is real, error-prone scope this app doesn't need: the
 * only provider is Credentials, so there is no OAuth account-linking or
 * verification-token flow an Adapter would otherwise justify.
 */

/** Never let a raw user-supplied email reach the audit log unnormalized —
 * this is for internal diagnostics only, never shown to the caller. */
function auditEmail(email: string): string {
  return email.trim().toLowerCase().slice(0, 254);
}

/**
 * `token.role` round-trips through Auth.js's encrypted JWT as `unknown` —
 * the `next-auth/jwt` module re-exports `JWT` via `export *`, which (unlike
 * the named `export type {}` `next-auth` uses for `Session`/`User`) doesn't
 * let a `declare module` augmentation merge cleanly onto its properties'
 * *read* type, only their assignability. So every read is verified against
 * the real role set at runtime rather than trusted from the type system —
 * the same "never trust a stored value's shape blindly" posture
 * `password.ts` already applies to its own stored hash format.
 */
function isRole(value: unknown): value is Role {
  return typeof value === 'string' && value in ROLE_PERMISSIONS;
}

/** Distinct from a wrong-password `null` return: "too many attempts" is not
 * account-enumerable information (it fires the same way whether or not the
 * email belongs to a real account), so it's safe to surface as a specific
 * code rather than folding it into the generic invalid-credentials case. */
class RateLimitedSignin extends CredentialsSignin {
  override code = 'rate_limited';
}

const env = serverEnv();

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: env.AUTH_SECRET,
  trustHost: env.AUTH_TRUST_HOST === 'true' || env.NODE_ENV !== 'production',
  session: { strategy: 'jwt', maxAge: SESSION_TTL_MS / 1000 },
  pages: { signIn: '/admin/login' },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, request) {
        const email = typeof credentials?.email === 'string' ? credentials.email : '';
        const password = typeof credentials?.password === 'string' ? credentials.password : '';
        const ip = getClientIp(request);

        // Deliberately generic: the caller never learns *which* of these
        // failed (unknown email vs. wrong password vs. disabled account vs.
        // not an admin role) — only the audit log, for internal eyes only,
        // records the real reason.
        if (!email || !password) return null;

        // Keyed by (ip, email) so this doesn't help an attacker who simply
        // rotates emails from one IP, nor punish every user behind a shared
        // IP for one account's bad guesses — see `rate-limiter.ts`.
        const rateLimitKey = `${ip ?? 'unknown'}:${auditEmail(email)}`;
        const rateLimit = await getLoginRateLimiter().check(rateLimitKey);
        if (!rateLimit.allowed) {
          await recordAuditEvent({
            action: 'auth.login.failure',
            ip,
            before: { reason: 'RATE_LIMITED', email: auditEmail(email) },
          });
          throw new RateLimitedSignin();
        }

        const result = await verifyAdminCredentials(email, password);
        if (!result.ok) {
          await recordAuditEvent({
            action: 'auth.login.failure',
            ip,
            before: { reason: result.reason, email: auditEmail(email) },
          });
          return null;
        }

        const { token: dbSessionToken } = await createDbSession({
          userId: result.user.id,
          ip,
          userAgent: request.headers.get('user-agent'),
        });
        await touchLastLogin(result.user.id);
        await recordAuditEvent({ action: 'auth.login.success', userId: result.user.id, ip });

        const authUser = {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role,
          dbSessionToken,
        };
        return authUser;
      },
    }),
  ],
  callbacks: {
    /**
     * Runs on every request that reads the session, not just on sign-in.
     * `user` is only present on the request that just called `authorize()`
     * — every subsequent call re-validates `token.dbSessionToken` against
     * the DB and re-reads the live user, so a revoked session, a disabled
     * account, or a role change all take effect on the very next request
     * rather than waiting for the JWT to expire on its own.
     *
     * Returning `null` is Auth.js's documented signal to invalidate the
     * token (`Awaitable<JWT | null>` — confirmed directly against
     * `@auth/core`'s type definitions).
     */
    async jwt({ token, user }) {
      if (user) {
        if (isRole(user.role)) token.role = user.role;
        if (typeof user.dbSessionToken === 'string') token.dbSessionToken = user.dbSessionToken;
        return token;
      }

      const dbSessionToken = token.dbSessionToken;
      if (typeof dbSessionToken !== 'string') return null;

      const dbSession = await validateDbSession(dbSessionToken);
      if (!dbSession) return null;

      const liveUser = await getUserById(dbSession.userId);
      if (!liveUser || !liveUser.active || !isAdminRole(liveUser.role)) return null;

      token.sub = liveUser.id;
      token.name = liveUser.name;
      token.email = liveUser.email;
      token.role = liveUser.role;
      return token;
    },
    /** Mirrors the validated token onto the shape Server Components read —
     * `authorize.ts`'s `requireUser`/`requirePermission` are the only
     * intended consumers of `session.user.role`. */
    async session({ session, token }) {
      if (session.user && token.sub && isRole(token.role)) {
        session.user.id = token.sub;
        session.user.role = token.role;
      }
      return session;
    },
  },
  events: {
    /** Fires when `signOut()` is called — the one place that still has the
     * decoded JWT (with `dbSessionToken`) in hand, so the matching DB
     * session row is deleted in the same flow that clears the cookie.
     * `logout.ts`'s server action also revokes it directly beforehand as a
     * belt-and-braces measure (see there for why). */
    async signOut(message) {
      const token = 'token' in message ? message.token : null;
      const dbSessionToken = token?.dbSessionToken;
      if (typeof dbSessionToken === 'string') await revokeDbSession(dbSessionToken);
      const userId = typeof token?.sub === 'string' ? token.sub : null;
      await recordAuditEvent({ action: 'auth.logout', userId });
    },
  },
});
