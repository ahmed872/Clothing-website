# Environments and secrets

Three environments, one contract. Every variable is validated at startup by
`src/modules/core/env.schema.ts`, so a missing or malformed value fails
immediately and loudly instead of surfacing later as a confusing runtime error.

## The separation

|            | development                                 | test                                                       | production                                    |
| ---------- | ------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| Database   | local PostgreSQL, `luxedrive_dev`           | local/CI PostgreSQL, `luxedrive_test` (CI: `luxedrive_ci`) | managed PostgreSQL                            |
| Env source | `.env` (gitignored)                         | `.env.test` (gitignored) / CI job env                      | Vercel project environment variables          |
| Data       | disposable seed data                        | wiped and recreated by the test run                        | real customer data — never copied to a laptop |
| Migrations | `pnpm db:migrate` (creates migration files) | `pnpm db:deploy`                                           | `pnpm db:deploy` in the deploy pipeline only  |

The three never share a database. A destructive migration tried on
`luxedrive_dev` costs nothing; the same command against production is an
incident.

## The two rules that keep secrets out of the browser

**1. `NEXT_PUBLIC_` means public forever.** Next.js inlines any variable with
that prefix into client JavaScript at build time. It is not a visibility
setting that can be revoked later — once built and deployed, the value is in
every visitor's browser. `assertNoPublicSecrets()` throws at boot if a server
variable is ever given that prefix.

**2. Server env is unreachable from client code.** `src/modules/core/env.ts`
begins with `import 'server-only'`. If any client component imports it, even
transitively, **the build fails** rather than shipping the secret. This is
verified, not assumed — see the verification below.

### Verifying it

Two checks run in CI on every push:

- The build output is grepped for the database password and for any
  `postgresql://` string. Either one found in `.next/static` fails the job.
- A client component importing `serverEnv()` was tested during P01 and the
  build failed with `'server-only' cannot be imported from a Client Component
module`, exit code 1.

To repeat the second check by hand:

```bash
mkdir -p src/app/leak-test
cat > src/app/leak-test/page.tsx <<'EOF'
'use client';
import { serverEnv } from '@/modules/core/env';
export default function Leak() { return <p>{serverEnv().DATABASE_URL}</p>; }
EOF
pnpm build   # must fail
rm -rf src/app/leak-test
```

Note the directory name: Next.js ignores folders whose name starts with `_`, so
a test route called `__leak-test` is silently excluded and the check would
appear to pass while proving nothing.

## Which values are secret

| Variable                                                             | Secret | Used from                  | Phase   |
| -------------------------------------------------------------------- | ------ | -------------------------- | ------- |
| `DATABASE_URL`                                                       | yes    | server only                | now     |
| `NEXT_PUBLIC_SITE_URL`                                               | no     | browser + server           | now     |
| `NEXT_PUBLIC_DEFAULT_LOCALE`                                         | no     | browser + server           | now     |
| `STORAGE_PROVIDER`                                                   | no     | server only                | P04     |
| `MEDIA_UPLOAD_SIGNING_SECRET` (local provider)                       | yes    | server only                | P04     |
| `MEDIA_LOCAL_STORAGE_DIR` (local provider)                           | no     | server only                | P04     |
| `STORAGE_BUCKET`, `STORAGE_ENDPOINT`, `STORAGE_REGION` (s3 provider) | no     | server only                | P04     |
| `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` (s3 provider)   | yes    | server only                | P04     |
| `MEDIA_PUBLIC_BASE_URL`                                              | no     | server only                | P04     |
| `AUTH_SECRET`                                                        | yes    | server only                | P06     |
| `AUTH_TRUST_HOST`                                                    | no     | server only                | P06/P14 |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` (script-only)    | yes    | `create-admin` script only | P06     |
| `PAYMENT_API_KEY`, `PAYMENT_WEBHOOK_SECRET`                          | yes    | server only                | P11     |
| `EMAIL_PROVIDER`                                                     | no     | server only                | P13     |
| `EMAIL_DISPATCH_SECRET`                                              | yes    | server only                | P13     |
| `EMAIL_FROM`, `EMAIL_FROM_NAME`                                      | no     | server only                | P13     |
| `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USER` (smtp)       | no     | server only                | P13     |
| `EMAIL_SMTP_PASSWORD` (smtp)                                         | yes    | server only                | P13     |
| `EMAIL_TEST_INBOX_DIR` (test provider)                               | no     | server only (test runs)    | P13     |

### Media storage (P04)

`STORAGE_PROVIDER` picks the backend behind the one `StorageProvider`
interface in `src/modules/media` — `local` (the default) needs nothing but
`MEDIA_UPLOAD_SIGNING_SECRET`; `s3` targets any S3-compatible bucket (AWS S3,
Cloudflare R2, MinIO, Wasabi, …) and requires the four `STORAGE_*` values.
Neither is faked when unset — `s3` without its credentials fails startup
rather than silently pretending an integration exists. See
`.env.example` for the exact contract and `MediaAsset.provider` for which
backend actually holds a given asset's bytes today.

#### Media storage in production (P14)

**`local` is a development and test backend. A serverless deployment needs
`s3`.** `local-provider.ts` says so in its own header comment; an earlier
P14 draft of this document contradicted it, listing `STORAGE_PROVIDER=local`
as one of the "free but genuinely production-ready" defaults alongside
`PAYMENT_PROVIDER=none` and `EMAIL_PROVIDER=console`. Those two are;
this one is not, and the difference is worth being precise about because
the failure is silent-looking and lands on the store owner's first product
photo.

`local` writes uploaded bytes to `MEDIA_LOCAL_STORAGE_DIR` under the
process's own working directory. On Vercel — and on any platform that runs
the application as ephemeral, horizontally-scaled function instances — that
directory is not a place bytes can be kept:

- the deployment's filesystem is read-only apart from `/tmp`, so the write
  fails outright rather than succeeding-then-vanishing;
- `/tmp`, if pointed at deliberately, is per-instance and per-invocation, so
  an upload confirmed by one instance is invisible to the next request and
  gone entirely on the next cold start;
- the `MediaAsset` row, meanwhile, is written to a real, shared, persistent
  database — so the catalog would carry rows whose bytes do not exist, which
  is worse than an upload that simply refuses.

Nothing about this is a gap in the code: `getStorageProvider()` reads
`STORAGE_PROVIDER` in exactly one place, `S3StorageProvider` implements the
same `StorageProvider` interface against any S3-compatible bucket (AWS S3,
Cloudflare R2, MinIO, Wasabi, Backblaze B2, …), and the four `STORAGE_*`
values are validated at boot. Switching is a configuration change, not a
code change — but it is a change production has to make.

`local` remains exactly right for what it was built for: a fresh checkout,
`pnpm dev`, and the whole test suite, none of which need anyone to hold a
cloud account. It is also a legitimate production choice on a single
long-lived host with a persistent volume (a VPS, a container with a mounted
disk) — which is why the schema does not refuse it outright the way it
refuses `AUTH_TRUST_HOST` being unset. It is refused by the platform, not
by us, and only on platforms where it cannot work.

### Authentication (P06)

`AUTH_SECRET` signs and encrypts the Auth.js session JWT — Auth.js reads it
automatically under this exact name, nothing in the codebase passes it
explicitly. Rotating it is a real, intentional action: every existing admin
session becomes unverifiable the moment the value changes (the JWT
signature no longer matches), which is the correct way to force a full
logout of every admin session at once if one is ever suspected compromised.

`AUTH_TRUST_HOST` is unset (and unnecessary) for local development; **it is
required whenever `NODE_ENV=production`** (P14), enforced at boot the same
way every other production-only requirement in this schema is. This was
discovered, not assumed: running a real `next build && next start` locally
(rather than only the dev server) showed every sign-in — customer and admin
alike — failing behind Auth.js's own generic "There was a problem with the
server configuration" page, with nothing in the application's logs pointing
at the cause, because Auth.js's `trustHost` defaults to `false` outside
development and this project's deployment target (Vercel) always sits in
front of the running app the way a reverse proxy does. Set to `"true"`,
Auth.js trusts the forwarded host/protocol headers instead of rejecting the
request. The one exception is the build step itself (`next build` also sets
`NODE_ENV=production` to compile, without ever serving a request) — the
schema recognizes that phase via Next.js's own `NEXT_PHASE` variable and
does not require `AUTH_TRUST_HOST` for it, so CI's `pnpm build` step needs
no change.

`BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD` are read only by
`pnpm db:create-admin` (`scripts/create-admin.mts`) — never by the running
app, never written to the database or logged anywhere. The script refuses
to run without both set; there is no default admin account and no
credential anywhere in source control, seed data, or the UI (the legacy
`admin`/`admin123` account was removed in P00 and never comes back).

### Email delivery (P13)

`EMAIL_PROVIDER` picks the backend behind the one `EmailProviderAdapter`
interface in `src/modules/notifications` — `console` (the default) needs
nothing at all and is a real, honest "not configured yet" stance identical
to `PAYMENT_PROVIDER="none"`: the outbox still gets drained and every event
still gets marked delivered, but "delivery" is a sanitized log line, not a
reached inbox. `smtp` is the real adapter (any SMTP-speaking transactional
service, or a self-hosted relay) and requires `EMAIL_SMTP_HOST`/
`EMAIL_SMTP_PORT`/`EMAIL_FROM` at minimum. `test` is the deterministic
adapter the test suite drives directly — set only in `.env.test`.

`EMAIL_DISPATCH_SECRET` is required unconditionally, the same way
`AUTH_SECRET` is: `POST /api/internal/email-dispatch` is real
spam-sending infrastructure the moment it exists, regardless of which
adapter is configured behind it, so the endpoint refuses every request
without a matching `Authorization: Bearer` value. A scheduler (Vercel Cron,
any external cron hitting the URL) is expected to call it periodically;
see `vercel.json` for the schedule this deployment uses.

`EMAIL_TEST_INBOX_DIR` is read only by the `test` adapter, and only exists
so a Playwright spec — a separate OS process from the running dev server —
can read what the app just attempted to send and pull a verification/reset
link out of it. Nothing under `console` or `smtp` ever writes there.

## Local setup

```bash
# 1. PostgreSQL 16 running locally, then:
createuser luxedrive --createdb --pwprompt
createdb luxedrive_dev -O luxedrive
createdb luxedrive_test -O luxedrive

# 2. Environment
cp .env.example .env          # set DATABASE_URL to match the user you created
cp .env .env.test             # point it at luxedrive_test
# .env.example already sets STORAGE_PROVIDER=local; replace
# MEDIA_UPLOAD_SIGNING_SECRET's and AUTH_SECRET's placeholders with real
# random values (`openssl rand -base64 32`) in both files.

# 3. Schema and client
pnpm install                  # runs `prisma generate` via postinstall
pnpm db:migrate               # applies migrations to luxedrive_dev
pnpm db:smoke                 # proves the connection and the typed client work

# 4. First admin account (P06) — one-off, values never committed:
BOOTSTRAP_ADMIN_EMAIL="owner@example.com" BOOTSTRAP_ADMIN_PASSWORD="a real password, 12+ chars" pnpm db:create-admin
```

### Running the test suites (P14)

The defaults above are the right _production_ defaults — payments off, email
logged rather than sent — and they are deliberately not what the test
suites need. Both suites drive the real adapters against local stand-ins,
so a `.env`/`.env.test` copied straight from `.env.example` leaves `pnpm
test` with 43 failures and the Playwright suite unable to run at all. This
was not written down anywhere before P14; it is now.

**`.env.test` (unit tests, `pnpm test`)** additionally needs:

```bash
PAYMENT_PROVIDER="hosted_checkout"
PAYMENT_API_BASE_URL="http://127.0.0.1:4011"   # scripts/payment-provider-stub.mjs
PAYMENT_API_KEY="any non-empty value"          # the stub does not check it
PAYMENT_WEBHOOK_SECRET="…"                     # openssl rand -hex 32
EMAIL_PROVIDER="test"
```

Without `PAYMENT_PROVIDER`, the order↔payment tests fail with
`A payment was requested while PAYMENT_PROVIDER is "none"` — the
application refusing to start a payment it has no provider for, which is
correct behaviour, not a bug in those tests.

**`.env` (end-to-end, `pnpm test:e2e`)** needs the same five values. `.env`,
not `.env.test`: Playwright drives a real `next dev` (or `next build &&
next start`) server, and that process reads `.env` like any other
development run — `.env.test` is only ever loaded by Vitest and by
`prisma.config.ts` under `NODE_ENV=test`. `EMAIL_PROVIDER="test"` is what
lets a spec read what the app just tried to send out of
`EMAIL_TEST_INBOX_DIR` and click the real verification link inside it.

`PAYMENT_WEBHOOK_SECRET` must be the _same_ value in `.env` as the payment
stub sees, since the stub signs its webhooks with it and the application
verifies them with the real HMAC code — the stub loads `.env` itself
(`.env.test` under `NODE_ENV=test`), so keeping the two files' payment
block identical is the simplest way to stay consistent.

The e2e suite seeds its own fixed accounts — the specs run
`pnpm db:seed-e2e-admins` themselves — but it does **not** seed the demo
catalog it browses, and six spec files (`storefront-*`,
`cart-promotions-accessibility`) navigate to a specific product by slug.
Against an empty catalog those specs do not fail quickly: the "Add to cart"
button never appears, the click waits, and the test dies on its own timeout
minutes later with nothing pointing at the real cause. Populate the
development database once, before the first e2e run:

```bash
pnpm db:seed-demo-catalog       # scripts/data/demo-catalog.json → the catalog
pnpm db:seed-storefront-demo    # publishes it, adds Arabic copy, homepage
pnpm db:seed-e2e-orders         # the fixed order the order specs open
pnpm db:seed-e2e-account        # the fixed customer account the account specs use
```

`db:seed-demo-catalog` refuses to run twice (it stops if a `cars` category
already exists); the other three are idempotent.

## Production (Vercel)

Set the variables in the Vercel project, per environment (Production, Preview,
Development). Nothing is read from a committed file.

- `DATABASE_URL` — the managed database's **pooled** connection string for the
  application.
- Migrations must not run through a connection pooler. Set
  `DIRECT_DATABASE_URL` to the provider's **direct** connection string and
  the deploy step swaps it in for the migration command only (Prisma 7
  removed `directUrl` from the schema, so this is the pipeline's job rather
  than configuration). Providers that hand out one string for both — or a
  self-hosted Postgres with no pooler — can leave it unset.

### The deploy applies its own migrations (P15)

`vercel.json` sets `buildCommand` to `pnpm vercel-build`, which is:

```
pnpm db:deploy:managed && pnpm db:bootstrap-admin && next build
```

This exists because a deployment has no shell. Without it, a first deploy
fails in a way that names nothing useful: the storefront's home, category
and product routes carry `revalidate`, so Next **prerenders them during the
build**, so the build reads `StoreSettings` and the catalog — and against a
database whose migrations were never applied, that surfaces as a Prisma
`TableDoesNotExist` stack trace while exporting `/ar`, several layers from
the actual cause. That was a real failure on this project's own Vercel
project, not a hypothetical: every deployment errored at ~17 seconds while
an older redeploy stayed live, which reads exactly like "the new code is
broken".

- `db:deploy:managed` (`scripts/migrate-deploy.mjs`) runs
  `prisma migrate deploy`, through `DIRECT_DATABASE_URL` when that is set.
  Applies only what is pending; a no-op against a current database.
- `db:bootstrap-admin` (`scripts/bootstrap-admin-if-absent.mts`) creates the
  first `OWNER` from `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD`
  **only when no admin account exists at all**, and skips silently when
  those are unset. Deliberately not `pnpm db:create-admin`, which resets the
  named account's password and re-asserts OWNER/active every run — correct
  for a command a person types, wrong for one a build runs unattended, where
  it would reset the owner's password on every deploy and re-enable an
  account someone had disabled on purpose.

⚠️ **Preview deployments now apply migrations too.** A Preview environment
whose `DATABASE_URL` points at the production database would apply that
branch's unreviewed migrations to production. Give Preview its own
database — the rule stated below, now with consequences.

Preview deployments must point at a database that is not production. A preview
branch running migrations against live data is the same incident as running
them by hand.

- `EMAIL_PROVIDER`/`EMAIL_DISPATCH_SECRET`/`EMAIL_FROM`/`EMAIL_SMTP_*` — set
  per environment like every other secret above. A Preview deployment left
  on `EMAIL_PROVIDER="console"` is a legitimate, honest choice (verification
  and reset links are logged, not delivered) rather than a broken one; only
  Production needs `smtp` actually configured.
- `vercel.json`'s `crons` entry calls `GET /api/internal/email-dispatch`
  once daily; Vercel Cron sends `Authorization: Bearer $CRON_SECRET`
  automatically for routes defined there, so the Vercel project's
  `CRON_SECRET` variable must be set to the _same_ value as
  `EMAIL_DISPATCH_SECRET` — there is no separate mechanism, just one shared
  secret the route checks the same way regardless of who is calling.

  **The once-daily cadence is deliberate, not a placeholder (P14).** Vercel's
  own documented plan limits (verified directly, not assumed) cap the
  **Hobby (free) plan at once-per-day minimum cron frequency** — a more
  frequent schedule is rejected at deploy time on that plan. Only the Pro
  plan and above support per-minute cron. Once-daily dispatch alone is too
  slow to be useful: it would leave most password-reset links (a 1-hour
  token TTL) expiring before a customer ever receives them.

  **The free-tier answer (this project's actual setup):**
  `.github/workflows/email-dispatch-cron.yml` calls the same endpoint every
  5 minutes from GitHub Actions instead. This repository is public, so
  GitHub Actions minutes for it are unlimited and free regardless of
  schedule frequency — unlike a private repository, where a 5-minute
  schedule would burn through the free minutes allowance quickly.
  `vercel.json`'s own once-daily cron entry stays in place as a slow safety
  net (so the outbox still drains once a day even if the GitHub Actions
  workflow or its secrets are ever misconfigured); calling the endpoint from
  both places is harmless since dispatch is idempotent-to-call.

  Setting this up requires two values configured once in this repository's
  own GitHub settings (Settings → Secrets and variables → Actions) — see
  the workflow file's own header comment for the exact names. Neither is
  committed anywhere; the workflow skips itself (rather than failing) until
  both are set.

  **Upgrading to Vercel Pro later** removes the need for the GitHub Actions
  workaround: change `vercel.json`'s schedule back to `*/5 * * * *` (or
  tighter) and either remove the GitHub Actions workflow or leave it running
  alongside it — both are safe.

## Production configuration checklist (P14)

Every value below is validated at boot by `src/modules/core/env.schema.ts` —
this list only says which are _required_ for a real production deploy versus
which have a safe, free, "not configured yet" default. No secret's actual
value is ever written in this file, in the repository, or in any report
generated about this project.

**Core — required in every environment:**

- `DATABASE_URL` — production's managed Postgres connection string.
- `AUTH_SECRET` — signs/encrypts the admin session JWT (Auth.js).
- `AUTH_TRUST_HOST="true"` — required the moment `NODE_ENV=production` (P14);
  every sign-in fails without it. See "Authentication (P06)" above for why.
- `NEXT_PUBLIC_SITE_URL` — the exact production origin; every email link and
  canonical URL is built from this value, never a request's `Host` header.
- `STORAGE_PROVIDER="s3"` plus its four `STORAGE_*` values — **required for
  a serverless deployment, Vercel included.** See "Media storage in
  production" below: this is the one place where the "free defaults are
  real production configurations" rule genuinely does not hold, and an
  earlier draft of this document said otherwise.

**Customer authentication** shares `AUTH_SECRET`'s session-signing
infrastructure and `DATABASE_URL`; it has no configuration of its own beyond
those two.

**Email:**

- `EMAIL_PROVIDER` — `console` is a real, free, honest "not sending yet"
  choice (see below); `smtp` requires the rest of this block.
- `EMAIL_DISPATCH_SECRET` — required unconditionally, regardless of which
  provider is selected (protects the dispatch endpoint itself).
- `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_FROM` — required only when
  `EMAIL_PROVIDER=smtp`.
- `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASSWORD` — required together, or omit both
  for an unauthenticated relay.
- `EMAIL_FROM_NAME` — optional, cosmetic.

**Payments (P11):**

- `PAYMENT_PROVIDER` — `none` is a real, free, fully-supported production
  configuration: checkout says payment is unavailable instead of offering a
  button that cannot work. Required (`PAYMENT_API_BASE_URL`,
  `PAYMENT_API_KEY`, `PAYMENT_WEBHOOK_SECRET`) only once a provider is
  actually enabled.

### What a multi-instance deployment changes (P14)

Three behaviours in this codebase are correct on one long-lived process and
weaker — or wrong — the moment the application runs as many short-lived
instances, which is exactly what a serverless host does. None of them is a
missing implementation; each is a deliberate adapter with the production
requirement written next to it. They are collected here because they are
easy to miss one at a time, and because two of them are security-relevant.

1. **Rate limiting is per-instance.** `InMemoryRateLimiter`
   (`identity/rate-limiter.ts`) keeps its counters in process memory, so
   each instance enforces its own budget and every cold start begins with an
   empty one. On a single always-on process the published limits hold
   exactly (login: 10 per 5 minutes per IP+email; password reset: 3 per 15
   minutes per address). Spread across N instances a caller gets up to N
   times that, and on a platform that starts a fresh instance readily, the
   window resets far more often than it expires. **A production deployment
   that scales past one instance needs a shared store** (Redis/Upstash or
   equivalent) behind the same `RateLimiter` interface — one new class and
   one line in the getters, no call-site changes. Until then the limiter is
   real but its guarantee is per-instance, and the login flow's other
   defences (generic non-enumerating errors, the 12-character admin password
   policy, DB-revocable sessions) are what carry the rest.

2. **Media storage must be `s3`.** See "Media storage in production" above.

3. **The outbox dispatcher's schedule is external.** Nothing inside the
   application drives it: something has to call
   `GET /api/internal/email-dispatch` on a cadence, and if that something
   silently stops, verification and reset emails stop with it and the
   application reports no error — the outbox simply keeps growing with
   `PENDING` rows. After deploying, confirm the schedule is _actually_
   firing (the GitHub Actions workflow's run history, and the Vercel cron's
   own logs) rather than assuming it from the fact that the files exist. A
   dispatcher whose worker is killed mid-send is handled in code — the claim
   is a five-minute lease and an abandoned row is picked back up (P14, see
   `CLAIM_LEASE_MS` in `email-dispatcher.ts`) — but a scheduler that never
   calls at all is not something the application can detect from inside.

### Staying on free infrastructure until this project has a paying client

Every default in this project is chosen so a real production deploy costs
nothing until a real vendor is actually needed:

- `PAYMENT_PROVIDER=none` and `EMAIL_PROVIDER=console` are each a genuine,
  working production configuration, not a stub — the application boots and
  functions completely with neither of them costing money. Verification and
  reset links are logged rather than emailed, and payment is visibly
  unavailable rather than broken.
- `STORAGE_PROVIDER=local` is **not** one of them, and a previous draft of
  this document was wrong to list it alongside the other two — see "Media
  storage in production" above. Object storage is the second thing a real
  deployment has to provision, after the database.
- Vercel itself has a permanent free (Hobby) tier suitable for this project
  at its current stage; nothing in this codebase requires a paid Vercel plan.
- A managed Postgres database is the one piece every configuration still
  needs — several providers (e.g. Neon, Supabase) have a free tier
  sufficient for early-stage traffic; which one to use is a deployment
  decision, not something this codebase assumes.
- An S3-compatible bucket is the other. Which provider is likewise a
  deployment decision this codebase does not assume — it speaks the S3 API
  rather than any one vendor's — and several offer a free or
  near-free entry tier at this project's volume. No pricing claim here is
  verified from inside this repository; check the provider's own current
  terms before committing to one.
- The moment `EMAIL_PROVIDER=smtp` is genuinely wanted (real verification/
  reset emails reaching real inboxes), an SMTP-speaking transactional
  service is needed — most (Postmark, SES, Mailgun's free tier, …) have a
  free tier generous enough for early volume; this project's adapter works
  against any of them unmodified, since it speaks SMTP itself rather than a
  specific vendor's API.
- `EMAIL_PROVIDER=smtp` without real credentials is refused at boot
  (`superRefine` in `env.schema.ts`) rather than silently pretending to
  work — so there is no way to accidentally deploy a broken email
  configuration; the failure is loud and immediate.
