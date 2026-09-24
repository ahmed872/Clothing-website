# LuxeDrive

A production-grade, general-purpose e-commerce platform: the store owner runs
the catalog, offers, orders and storefront content without a developer, and
cars are one kind of product rather than the shape of the system.

> **Status: code-complete, pending production provisioning.** The storefront,
> the customer account, checkout, the payment boundary, the admin panel and
> transactional email are all built and tested. What remains is not code —
> it is a database, a bucket, an SMTP account and a deployment. See
> [docs/environments.md](docs/environments.md#production-configuration-checklist-p14).

## What is built

**Storefront** (`/ar/…`, `/en/…`) — bilingual and RTL-aware throughout, in
light and dark themes: home, category and product pages, search, cart,
checkout, order confirmation and a payment step, plus customer accounts
(register, verify email, sign in, profile, order history, password reset).
A guest can shop and check out without an account; their cart merges into
their account when they create one.

**Admin** (`/admin`) — sign-in with real server-side sessions and
role-based access control, then products and variants, categories, brands,
inventory, pricing, promotions and coupons, orders, customers, store
settings, and staff/user administration. Every section in the sidebar is a
real screen; there is no "coming soon" page left in the admin.

**Homepage content** (`/admin/content`) — the store owner builds their own
homepage: ten section types (hero, banner, featured categories and
products, new arrivals, best sellers, active offers, testimonials, trust
blocks, custom promo), each with a real form in both languages rather than
a JSON box, plus ordering, show/hide, and a draft that visitors never see
until it is published. Until this existed the homepage could only be
populated by a development seed script, which is why a deployed store
showed "no content has been published yet".

**Analytics** (`/admin/analytics`) — paid revenue, orders, average order
value, units sold and new customers over a chosen period, with revenue by
day, best sellers, order-status breakdown, coupon usage and refund counts.
Built only on data the platform genuinely records: it does not net refunds
out of revenue (no refund amount is stored) and ships no "views" metric
(nothing writes the view tables), and the screen says so instead of
showing a number that would always be zero.

## Stack

|            |                                                          |
| ---------- | -------------------------------------------------------- |
| Framework  | Next.js (App Router), React, SSR + ISR                   |
| Language   | TypeScript, strict                                       |
| Styling    | Tailwind v4 with design tokens, shadcn/ui foundation     |
| Database   | PostgreSQL + Prisma (driver adapter)                     |
| Auth       | Auth.js — two separate instances, admin and storefront   |
| Validation | Zod, shared between server and client                    |
| Tests      | Vitest (unit + integration), Playwright (e2e, axe)       |
| Hosting    | Vercel + managed PostgreSQL + S3-compatible object store |

## Getting started

Requires Node 20.11+, pnpm 10, and a local PostgreSQL 16.

```bash
pnpm install                 # generates the Prisma client via postinstall
cp .env.example .env         # then set DATABASE_URL and the secrets it names

pnpm db:migrate              # apply migrations
pnpm db:smoke                # prove the connection and typed client work
pnpm dev                     # http://localhost:3000
```

Then create the first admin account and, optionally, load the demo catalog:

```bash
BOOTSTRAP_ADMIN_EMAIL="you@example.com" \
BOOTSTRAP_ADMIN_PASSWORD="a real password, 12+ chars" pnpm db:create-admin

pnpm db:seed-demo-catalog     # scripts/data/demo-catalog.json → the catalog
pnpm db:seed-storefront-demo  # publish it, add Arabic copy, seed the homepage
```

Both are development conveniences, not a deployment step. A real store
never runs the second one: it builds its homepage at `/admin/content` and
publishes its products from `/admin/products` — a newly created product is
a **draft**, and a draft appears nowhere in the storefront until it is
published.

Full environment setup — including the test database, the extra variables
both test suites need, and the production variables — is in
[docs/environments.md](docs/environments.md).

## Commands

| Command           | What it does                                     |
| ----------------- | ------------------------------------------------ |
| `pnpm dev`        | development server                               |
| `pnpm build`      | production build                                 |
| `pnpm verify`     | typecheck → lint → test → build (what CI runs)   |
| `pnpm typecheck`  | TypeScript, no emit                              |
| `pnpm lint`       | ESLint, including module boundary rules          |
| `pnpm format`     | Prettier                                         |
| `pnpm test`       | unit and integration tests (needs the test DB)   |
| `pnpm test:e2e`   | Playwright — journeys, axe, visual regression    |
| `pnpm db:migrate` | create and apply a migration (development)       |
| `pnpm db:deploy`  | apply existing migrations (test, production)     |
| `pnpm db:smoke`   | verify the database connection end to end        |
| `pnpm db:backup`  | logical backup — see docs/backup-and-recovery.md |

`pnpm test` and `pnpm test:e2e` both need a few variables beyond
`.env.example`'s production-shaped defaults, and the e2e suite needs the
demo catalog seeded — see
[docs/environments.md](docs/environments.md#running-the-test-suites-p14).

## Documentation

- [Architecture](docs/architecture.md) — repository layout, the fifteen
  modules, how the dependency rules are enforced.
- [Environments and secrets](docs/environments.md) — development, test and
  production separation, why no secret can reach the browser, what a real
  production deploy has to provision, and what changes once the application
  runs as more than one instance.
- [Backup and recovery](docs/backup-and-recovery.md) — what is backed up, how
  to restore, and the restore drill.

## Security posture, in one paragraph

Every admin and account boundary is checked on the server, in the Server
Action or Server Component itself — a hidden button is never treated as
authorization, and the test suite calls those boundaries directly rather
than through the UI to prove it. Sessions are JWT-transported but
database-backed, so a role change, a disable, or a revocation takes effect
on the account's next request rather than at token expiry. Money, stock and
order totals are derived server-side from data the client cannot name;
checkout accepts no price, no total and no cart id. Payment outcomes move
only on an HMAC-verified webhook. Server-only environment access is enforced
by the build, and CI greps the client bundle for the database password on
every push.

## The application this replaced

The original Vite single-page app was archived to its own repository once
the rebuild was complete; it is no longer part of this one. Its full
history is still reachable here in the commits before the rebuild began.

Its `cars.json` survives as `scripts/data/demo-catalog.json`, the demo
fixture `pnpm db:seed-demo-catalog` loads — the data outlived the
application that shipped it.

## Admin access

There is no default admin account, and no credential anywhere in source
control, seed data or the UI. The first account is created once, by hand,
with `pnpm db:create-admin`, from environment variables the running
application never reads. (The original build hardcoded credentials in
client-side JavaScript and printed them on the login page; they were removed
in P00 and have not come back.) After that, an owner adds and manages the
rest of the team at `/admin/users`.
