import 'server-only';

import type { Role } from '@generated/prisma';
import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

import { serverEnv } from '@/modules/core';

import { recordAuditEvent } from './audit.service';
import { getClientIp } from './request-ip';
import { getCustomerLoginRateLimiter } from './rate-limiter';
import { createDbSession, revokeDbSession, validateDbSession } from './session.service';
import { getUserById, touchLastLogin, verifyCustomerCredentials } from './user.service';

/**
 * The storefront's own Auth.js v5 instance — separate from `auth.ts` in
 * every way that matters, not merely in the role it happens to check
 * (P12 §3/§6):
 *
 *   a different route mount (`basePath`), so its internal endpoints
 *   (signin/signout/callback) never collide with the admin instance's;
 *
 *   physically different cookies (`name` overridden below on every cookie
 *   Auth.js sets), so a customer session and an admin session cannot be
 *   confused, substituted, or accidentally read by the other instance's
 *   code — there is no shared cookie for a bug to misinterpret;
 *
 *   its own rate limiter, audit vocabulary, and — because a shopper expects
 *   "stay signed in" and an admin's session is a shift, not a residency —
 *   its own, much longer session lifetime.
 *
 * What *is* reused, deliberately: the same `Session` DB-revocation table and
 * `session.service.ts` functions, the same password hashing, the same
 * generic-failure-message discipline, the same hybrid JWT-cookie +
 * DB-revalidation architecture `auth.ts`'s own docstring explains. This is
 * the one Auth.js app supporting two audiences by configuration, not two
 * bespoke session systems reinventing the same guarantees twice.
 */

/** 30 days: long enough that a returning shopper stays recognised across a
 * normal browsing gap, unlike the admin's 12-hour shift session. Revocable
 * the same way regardless of length — `revokeDbSession`/`revokeAllUserSessions`
 * don't care how long a session was issued for. */
export const CUSTOMER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function auditEmail(email: string): string {
  return email.trim().toLowerCase().slice(0, 254);
}

function isCustomerRole(value: unknown): value is Role {
  return value === 'CUSTOMER';
}

class RateLimitedSignin extends CredentialsSignin {
  override code = 'rate_limited';
}

const env = serverEnv();
const useSecureCookies = env.NODE_ENV === 'production';
/** Mirrors `@auth/core`'s own `defaultCookies()` prefixing rule exactly
 * (`__Secure-` for the session/callback cookie, the stricter `__Host-` for
 * CSRF) — supplying a custom `name` replaces Auth.js's default entirely, so
 * the secure-cookie prefix has to be re-applied here by hand or production
 * would silently lose it. */
const securePrefix = useSecureCookies ? '__Secure-' : '';
const hostPrefix = useSecureCookies ? '__Host-' : '';

export const {
  handlers: customerHandlers,
  auth: customerAuth,
  signIn: customerSignIn,
  signOut: customerSignOut,
} = NextAuth({
  secret: env.AUTH_SECRET,
  trustHost: env.AUTH_TRUST_HOST === 'true' || env.NODE_ENV !== 'production',
  basePath: '/api/customer-auth',
  session: { strategy: 'jwt', maxAge: CUSTOMER_SESSION_TTL_MS / 1000 },
  // Locale-agnostic fallback only: the real sign-in surface is whichever
  // locale's `/account/login` the customer is actually on, reached through
  // this app's own server-side redirect (see `account/(protected)/layout.tsx`),
  // never through Auth.js's own automatic redirect. This path only matters
  // for the narrow internal cases Auth.js itself redirects on.
  pages: { signIn: '/ar/account/login' },
  useSecureCookies,
  cookies: {
    sessionToken: { name: `${securePrefix}luxedrive.customer-session-token` },
    callbackUrl: { name: `${securePrefix}luxedrive.customer-callback-url` },
    csrfToken: { name: `${hostPrefix}luxedrive.customer-csrf-token` },
  },
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

        // Generic on purpose, same as the admin surface: the caller never
        // learns which fact was wrong, only the audit log does.
        if (!email || !password) return null;

        const rateLimitKey = `${ip ?? 'unknown'}:${auditEmail(email)}`;
        const rateLimit = await getCustomerLoginRateLimiter().check(rateLimitKey);
        if (!rateLimit.allowed) {
          await recordAuditEvent({
            action: 'customer.login.failure',
            ip,
            before: { reason: 'RATE_LIMITED', email: auditEmail(email) },
          });
          throw new RateLimitedSignin();
        }

        const result = await verifyCustomerCredentials(email, password);
        if (!result.ok) {
          await recordAuditEvent({
            action: 'customer.login.failure',
            ip,
            before: { reason: result.reason, email: auditEmail(email) },
          });
          return null;
        }

        const { token: dbSessionToken } = await createDbSession({
          userId: result.user.id,
          ip,
          userAgent: request.headers.get('user-agent'),
          ttlMs: CUSTOMER_SESSION_TTL_MS,
        });
        await touchLastLogin(result.user.id);
        await recordAuditEvent({ action: 'customer.login.success', userId: result.user.id, ip });

        return {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role,
          dbSessionToken,
        };
      },
    }),
  ],
  callbacks: {
    /** Same re-validation discipline as the admin instance's callback: every
     * request re-checks the DB session and the live user, so a revoked
     * session, a disabled account, or — the check that matters here — a
     * role that has stopped being CUSTOMER, all take effect on the very
     * next request rather than waiting out the JWT. */
    async jwt({ token, user }) {
      if (user) {
        if (isCustomerRole(user.role)) token.role = user.role;
        if (typeof user.dbSessionToken === 'string') token.dbSessionToken = user.dbSessionToken;
        return token;
      }

      const dbSessionToken = token.dbSessionToken;
      if (typeof dbSessionToken !== 'string') return null;

      const dbSession = await validateDbSession(dbSessionToken);
      if (!dbSession) return null;

      const liveUser = await getUserById(dbSession.userId);
      if (!liveUser || !liveUser.active || liveUser.role !== 'CUSTOMER') return null;

      token.sub = liveUser.id;
      token.name = liveUser.name;
      token.email = liveUser.email;
      token.role = liveUser.role;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub && isCustomerRole(token.role)) {
        session.user.id = token.sub;
        session.user.role = token.role;
      }
      return session;
    },
  },
  events: {
    async signOut(message) {
      const token = 'token' in message ? message.token : null;
      const dbSessionToken = token?.dbSessionToken;
      if (typeof dbSessionToken === 'string') await revokeDbSession(dbSessionToken);
      const userId = typeof token?.sub === 'string' ? token.sub : null;
      await recordAuditEvent({ action: 'customer.logout', userId });
    },
  },
});
