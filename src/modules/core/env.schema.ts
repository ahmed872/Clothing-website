import { z } from 'zod';

/**
 * Environment contract.
 *
 * Split deliberately in two: anything in `serverEnvSchema` is a secret or a
 * server-only detail and must never reach the browser bundle. Anything in
 * `clientEnvSchema` is public by definition — Next.js inlines every
 * `NEXT_PUBLIC_*` value into client JavaScript, so nothing sensitive may ever
 * carry that prefix.
 *
 * This file is intentionally pure (no `process.env` access, no `server-only`
 * import) so it can be unit tested. Reading the actual environment happens in
 * `env.ts` (server) and `env.client.ts` (client).
 */

/**
 * `local` (the default) needs nothing else set — media uploads land on local
 * disk, so a fresh checkout works before anyone has real object-storage
 * credentials. `s3` targets any S3-compatible bucket (AWS S3, R2, MinIO,
 * Wasabi, …) and requires the fields the `.superRefine` below enforces.
 * Never faked: a missing credential fails startup instead of the app
 * pretending an S3 integration exists (P04).
 */
const storageProviderSchema = z.enum(['local', 's3']);

/** Which payment adapter runs. `none` is a real, supported configuration and
 * the default: an environment with no provider credentials still boots, and
 * checkout says payment is unavailable rather than offering a button that
 * cannot work (P11 §5). */
const paymentProviderSchema = z.enum(['none', 'hosted_checkout']);

/**
 * Which email adapter the outbox dispatcher sends through (P13 §1/§2).
 *
 *   console  the default. Real, working, and safe with zero configuration —
 *            an outbox event still gets claimed and marked `SENT`, but
 *            delivery is a single sanitized log line (no link, no token),
 *            the same honest "provider is off" stance `PAYMENT_PROVIDER:
 *            none` already takes. Nobody's inbox is reached; nothing is
 *            faked.
 *   smtp     the real provider — any SMTP-speaking transactional service
 *            (Postmark, SES, Mailgun, Resend, a self-hosted relay, …) or a
 *            vendor's own SMTP endpoint. SMTP is an IETF standard
 *            (RFC 5321), not one vendor's private API, which is why this is
 *            the adapter that gets built out rather than a guessed vendor
 *            HTTP contract — see `smtp-provider.ts`'s own comment. Requires
 *            the `EMAIL_SMTP_*` block below; environment-blocked wherever
 *            those are unset (true of every environment this project has
 *            touched so far — no SMTP credentials exist anywhere in this
 *            repository's history).
 *   test     the deterministic adapter `email-dispatcher.test.ts` and the
 *            E2E specs drive directly: every attempted send becomes a JSON
 *            file under `EMAIL_TEST_INBOX_DIR` and reaches nobody. Selected
 *            from `.env.test`, and from a local `.env` while running the
 *            Playwright suite (which drives a real server process — see
 *            docs/environments.md's "Running the test suites"). Never a
 *            real deployment's value.
 */
const emailProviderSchema = z.enum(['console', 'smtp', 'test']);

const baseServerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Set by Next.js itself during `next build` (`phase-production-build`) —
   * never by a person, never documented as something to configure. Read
   * here only to tell "compiling" apart from "actually serving traffic":
   * Next.js sets `NODE_ENV=production` for both, but only the latter is a
   * real deployment the `AUTH_TRUST_HOST` check below should apply to (a
   * `pnpm build` run in CI or on a laptop is not itself "behind a reverse
   * proxy" the way a running deployment is). Never present in a real
   * request's environment, only during the build step. */
  NEXT_PHASE: z.string().optional(),

  /** PostgreSQL connection string. Secret. */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required').startsWith('postgres'),

  STORAGE_PROVIDER: storageProviderSchema.default('local'),

  /** S3-compatible bucket. Required only when STORAGE_PROVIDER=s3. */
  STORAGE_BUCKET: z.string().min(1).optional(),
  /** Omit for real AWS S3; set for any other S3-compatible endpoint (R2, MinIO, Wasabi, …). */
  STORAGE_ENDPOINT: z.string().url().optional(),
  STORAGE_REGION: z.string().min(1).optional(),
  /** Secret. */
  STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
  /** Secret. */
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),

  /** Public delivery base (a CDN domain, ideally). Falls back to a
   * provider-appropriate default when unset — see media/cdn.ts. */
  MEDIA_PUBLIC_BASE_URL: z.string().url().optional(),
  /** Local-provider only: where uploaded files land on disk. Gitignored. */
  MEDIA_LOCAL_STORAGE_DIR: z.string().min(1).default('.local-storage/media'),
  /** Secret. HMAC key the local provider uses to sign upload URLs — its
   * equivalent of the AWS credentials that sign a real presigned URL.
   * Required only when STORAGE_PROVIDER=local. */
  MEDIA_UPLOAD_SIGNING_SECRET: z.string().min(32).optional(),

  /** Secret. Signs and encrypts the Auth.js JWT session cookie (P06). Read
   * automatically by Auth.js under this exact name — never pass it in code.
   * Generate with `openssl rand -base64 32`. */
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  /** Set to "true" only when deployed behind a reverse proxy that Auth.js
   * should trust for the request's host/protocol (production). Read
   * automatically by Auth.js under this exact name.
   *
   * Required whenever `NODE_ENV=production` (P14 §5/§10) — discovered by
   * actually running a real `next build && next start` rather than only
   * the dev server: Auth.js's own `trustHost` defaults to `false` outside
   * development, and every deployment target this project has (Vercel's
   * serverless/edge routing included) sits in front of the app exactly like
   * a reverse proxy from Auth.js's point of view. Without this set,
   * `trustHost` is falsy in production and Auth.js refuses every sign-in —
   * customer and admin alike — behind one generic "There was a problem
   * with the server configuration" page, with nothing in the application's
   * own logs pointing at the cause. Enforcing it at boot turns that into an
   * immediate, specific failure instead of a production outage discovered
   * by users unable to log in. */
  AUTH_TRUST_HOST: z.enum(['true', 'false']).optional(),

  /** P11. Which payment adapter to run; `none` disables payment entirely. */
  PAYMENT_PROVIDER: paymentProviderSchema.default('none'),
  /** Base URL of the provider's API. Required when a provider is enabled.
   * Not a secret, but environment-specific — sandbox and live differ. */
  PAYMENT_API_BASE_URL: z.string().url().optional(),
  /** Secret. Bearer credential for the provider's API. Never logged, never
   * sent to the browser, never stored on a `Payment` row. */
  PAYMENT_API_KEY: z.string().min(1).optional(),
  /** Secret. HMAC key the provider signs its webhooks with. This is the only
   * thing standing between the payment domain and anyone who can POST to the
   * webhook URL, so it is required whenever a provider is enabled — there is
   * no "verification off" mode. Generate with `openssl rand -hex 32`. */
  PAYMENT_WEBHOOK_SECRET: z.string().min(32).optional(),

  /** P13. Which email adapter the outbox dispatcher uses. Defaults to the
   * always-available, zero-config `console` adapter — see
   * `emailProviderSchema` above for what each value means. */
  EMAIL_PROVIDER: emailProviderSchema.default('console'),
  /** The `From` address every outgoing email carries. Not a secret, but a
   * real, deliverable address — most providers reject sends from a domain
   * they have not verified, so this is required the moment a real adapter
   * (`smtp`) is selected, not merely a cosmetic default. */
  EMAIL_FROM: z.string().email().optional(),
  /** Display name paired with `EMAIL_FROM` ("LuxeDrive <no-reply@…>").
   * Cosmetic only; falls back to "LuxeDrive" when unset. */
  EMAIL_FROM_NAME: z.string().min(1).optional(),

  /** `smtp` adapter only. Not a secret — sandbox and live differ, and this
   * is the provider's hostname, not a credential. */
  EMAIL_SMTP_HOST: z.string().min(1).optional(),
  /** `smtp` adapter only. Standard ports: 587 (STARTTLS, the common case),
   * 465 (implicit TLS), 25 (unencrypted — refused by `smtp-provider.ts`
   * outside explicit opt-in, since a password would otherwise cross the
   * network in the clear). */
  EMAIL_SMTP_PORT: z.coerce.number().int().positive().optional(),
  /** `smtp` adapter only. Not a secret by itself (often just an address or
   * account id), but paired with the password below to authenticate. */
  EMAIL_SMTP_USER: z.string().min(1).optional(),
  /** Secret. `smtp` adapter only. Never logged, never sent to the browser,
   * never stored on an `OutboxEvent` row. */
  EMAIL_SMTP_PASSWORD: z.string().min(1).optional(),

  /** `test` adapter only. Where each attempted send is written as one JSON
   * file, so a Playwright spec — a separate process from the dev server —
   * can read what the app just "sent" and extract a verification/reset
   * link from it. Never read outside `EMAIL_PROVIDER=test`; never a path a
   * production deploy's `EMAIL_PROVIDER` (`console`/`smtp`) touches. */
  EMAIL_TEST_INBOX_DIR: z.string().min(1).default('.local-storage/test-email-inbox'),

  /** Secret. Bearer credential the outbox dispatch endpoint requires
   * (`Authorization: Bearer <value>`) — see
   * `src/app/api/internal/email-dispatch/route.ts`. Required unconditionally
   * (not just when a real provider is configured): the endpoint is real
   * infrastructure the moment it exists, whatever adapter is behind it, and
   * an unauthenticated dispatch trigger is a spam primitive regardless of
   * where the mail actually goes. Generate with `openssl rand -hex 32`.
   *
   * Restricted to visible ASCII with no whitespace (P14 §5/§6): this value
   * is required to round-trip through an HTTP header both as Vercel's own
   * `CRON_SECRET` (sent as `Authorization: Bearer $CRON_SECRET`) and as
   * whatever this app compares it against. Vercel's own cron troubleshooting
   * guide names a stray newline or other header-invalid character pasted
   * into the secret as a real, observed cause of cron requests silently
   * losing their Authorization header in production — a failure that would
   * otherwise surface only as every cron-triggered dispatch returning 401,
   * discovered after deploying. Rejecting that shape at config-parse time
   * turns it into a boot-time error instead. */
  EMAIL_DISPATCH_SECRET: z
    .string()
    .min(32, 'EMAIL_DISPATCH_SECRET must be at least 32 characters')
    .regex(
      /^[\x21-\x7E]+$/,
      'EMAIL_DISPATCH_SECRET must contain only visible ASCII characters with no whitespace (it must be safe inside an HTTP Authorization header)',
    ),

  /** Script-only (`scripts/create-admin.mts`) — never read by the running
   * app, so a missing value here never breaks a normal boot. Deliberately
   * outside this schema's enforcement: requiring it at all times would mean
   * every environment needs a bootstrap admin password set forever, when
   * it's only needed once, by the person running the script. */
});

export const serverEnvSchema = baseServerEnvSchema.superRefine((value, ctx) => {
  if (
    value.NODE_ENV === 'production' &&
    value.NEXT_PHASE !== 'phase-production-build' &&
    value.AUTH_TRUST_HOST !== 'true'
  ) {
    // See AUTH_TRUST_HOST's own doc comment above (P14) — verified by
    // actually running `next build && next start` and watching every
    // sign-in fail behind Auth.js's generic configuration-error page.
    // Skipped during the build phase itself (see NEXT_PHASE's own comment)
    // so `pnpm build` in CI/locally is unaffected — this only gates a
    // process that will actually serve requests.
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_TRUST_HOST'],
      message:
        'AUTH_TRUST_HOST must be "true" when NODE_ENV=production — Auth.js refuses every sign-in without it on this deployment target. See AUTH_TRUST_HOST\'s doc comment in this file.',
    });
  }
  if (value.STORAGE_PROVIDER === 's3') {
    for (const key of [
      'STORAGE_BUCKET',
      'STORAGE_ACCESS_KEY_ID',
      'STORAGE_SECRET_ACCESS_KEY',
    ] as const) {
      if (!value[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when STORAGE_PROVIDER=s3`,
        });
      }
    }
  }
  if (value.PAYMENT_PROVIDER !== 'none') {
    // A provider that is switched on without its credentials is worse than
    // one that is off: the store would offer a pay button that fails after
    // the customer commits. Refusing to boot says so at deploy time instead.
    for (const key of [
      'PAYMENT_API_BASE_URL',
      'PAYMENT_API_KEY',
      'PAYMENT_WEBHOOK_SECRET',
    ] as const) {
      if (!value[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when PAYMENT_PROVIDER is not "none"`,
        });
      }
    }
  }
  if (value.STORAGE_PROVIDER === 'local' && !value.MEDIA_UPLOAD_SIGNING_SECRET) {
    ctx.addIssue({
      code: 'custom',
      path: ['MEDIA_UPLOAD_SIGNING_SECRET'],
      message: 'MEDIA_UPLOAD_SIGNING_SECRET is required when STORAGE_PROVIDER=local (the default)',
    });
  }
  if (value.EMAIL_PROVIDER === 'smtp') {
    // Same reasoning as payments above: an adapter switched on without its
    // credentials would claim delivery while every send silently fails.
    for (const key of ['EMAIL_SMTP_HOST', 'EMAIL_SMTP_PORT', 'EMAIL_FROM'] as const) {
      if (!value[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when EMAIL_PROVIDER=smtp`,
        });
      }
    }
    // Authentication is a pair, not two independent optionals — a host with
    // a username and no password (or vice versa) is a configuration typo,
    // not a legitimate "unauthenticated relay" setup, which this schema
    // does not try to distinguish from one.
    if (Boolean(value.EMAIL_SMTP_USER) !== Boolean(value.EMAIL_SMTP_PASSWORD)) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_SMTP_PASSWORD'],
        message: 'EMAIL_SMTP_USER and EMAIL_SMTP_PASSWORD must both be set, or neither',
      });
    }
  }
});

export const clientEnvSchema = z.object({
  /** Absolute public origin, used for canonical URLs, sitemaps and hreflang. */
  NEXT_PUBLIC_SITE_URL: z.string().url(),

  /** Default storefront locale. Arabic is the default per ADR-023. */
  NEXT_PUBLIC_DEFAULT_LOCALE: z.enum(['ar', 'en']).default('ar'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

/** Prefix reserved by Next.js for values that are inlined into client JS. */
const PUBLIC_PREFIX = 'NEXT_PUBLIC_';

/**
 * Guard against the single most damaging environment mistake: giving a secret
 * a `NEXT_PUBLIC_` name, which silently publishes it to every visitor.
 */
export function assertNoPublicSecrets(schemaKeys: readonly string[]): void {
  const leaked = schemaKeys.filter((key) => key.startsWith(PUBLIC_PREFIX));
  if (leaked.length > 0) {
    throw new Error(
      `Server environment variables must not use the ${PUBLIC_PREFIX} prefix, ` +
        `because Next.js inlines those into the browser bundle. Offending keys: ${leaked.join(', ')}`,
    );
  }
}

export type ParseResult<T> = { success: true; data: T } | { success: false; message: string };

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/** Parse and validate the server environment. Never throws raw Zod errors. */
export function parseServerEnv(source: Record<string, string | undefined>): ParseResult<ServerEnv> {
  assertNoPublicSecrets(Object.keys(baseServerEnvSchema.shape));
  const result = serverEnvSchema.safeParse(source);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    message: `Invalid server environment:\n${formatIssues(result.error)}`,
  };
}

/** Parse and validate the client environment. */
export function parseClientEnv(source: Record<string, string | undefined>): ParseResult<ClientEnv> {
  const result = clientEnvSchema.safeParse(source);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    message: `Invalid client environment:\n${formatIssues(result.error)}`,
  };
}
