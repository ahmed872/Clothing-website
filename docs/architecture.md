# Architecture

The decisions behind this structure are recorded in the Final ADR. This
document is the working map: where code goes, what may import what, and how
that is enforced.

## Repository layout

```
.
├── .github/workflows/ci.yml   install → typecheck → lint → test → migrate → build
├── docs/                      environments, backup and recovery, this file
├── generated/prisma/          generated Prisma client (gitignored)
├── prisma/
│   ├── schema.prisma          the data model
│   └── migrations/            applied migrations, in order
├── scripts/                   backup.sh, db-smoke.mjs, seed data and fixtures
└── src/
    ├── app/                   Next.js App Router (routes and layouts only)
    ├── components/ui/         design system components
    ├── lib/                   presentation helpers (cn)
    └── modules/               the domain — one folder per bounded module
```

The original Vite application that this replaced was archived to its own
repository once the rebuild was complete, and no longer lives here. Only its
catalog data remains, as `scripts/data/demo-catalog.json`.

## Modules

Fifteen modules, each owning one part of the domain. A module's `index.ts` is
its public surface: other modules import `@/modules/<name>` and never a file
inside it.

```
core → identity → media → catalog → search
                            ↓
                        inventory → pricing → cart → orders
                                                       ↓
                                     payments · notifications
 customers · content · settings · analytics
```

| Module          | Owns                                               | May import                                                                  |
| --------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| `core`          | database client, environment, errors, money        | —                                                                           |
| `identity`      | users, sessions, roles, audit log                  | core                                                                        |
| `media`         | assets, uploads, storage providers                 | core                                                                        |
| `catalog`       | products, categories, brands, attributes, variants | core, media                                                                 |
| `search`        | search service and providers                       | core, catalog                                                               |
| `inventory`     | stock levels, adjustment history                   | core, catalog                                                               |
| `pricing`       | price resolution, discounts, coupons               | core, catalog                                                               |
| `cart`          | cart lifecycle                                     | core, catalog, pricing, inventory                                           |
| `customers`     | accounts, addresses, wishlist, reviews             | core, identity, catalog                                                     |
| `payments`      | payment service, providers, webhooks               | core                                                                        |
| `notifications` | channels, templates                                | core, settings                                                              |
| `content`       | homepage sections, banners, navigation             | core, media, catalog                                                        |
| `settings`      | store settings, branding, shipping config          | core, media                                                                 |
| `analytics`     | reporting queries, rollups (read-only)             | core                                                                        |
| `orders`        | order lifecycle, state machine, events             | core, catalog, pricing, inventory, cart, customers, payments, notifications |

Two rules matter more than the rest:

- **`catalog` does not know `orders` exists.** The catalog describes what is
  for sale; it must not learn about selling. Breaking this is how a product
  model ends up with order-shaped fields.
- **`analytics` never writes.** Reporting that mutates is how numbers stop
  matching reality. This one is not left to code review:
  `analytics/read-only.test.ts` runs every exported query against a Proxy
  over the database client that throws on any write method, `$executeRaw*`
  or `$transaction`, and separately greps the module's own source for a
  write call. Both halves were verified by adding a deliberate write and
  watching them fail.

### What each module actually holds today

As of P15 every module above owns a real, used implementation. Three are
worth describing rather than leaving to be discovered:

- **`analytics` reports only what the database actually records.** Revenue,
  average order value and units sold come from orders whose `paymentStatus`
  is `PAID`; the daily series is grouped in SQL by UTC day. Two things it
  deliberately does _not_ do: it never nets refunds out of revenue (the
  schema stores _that_ an order was refunded, never _how much_, so it
  reports refunded-order counts instead), and it ships no "views" metric —
  `ProductView` and `DailyProductStats` exist in the schema and nothing
  anywhere writes to them, so such a panel would read zero forever. The
  admin screen states both in a methodology note rather than letting a
  reader assume otherwise.
- **`content` and `settings` are read-write.** Both were read-only until
  P15, with values set by the seed script or by hand in the database. The
  homepage in particular could therefore only ever be populated by
  `db:seed-storefront-demo` — which meant a real deployment's homepage was
  empty by construction. `/admin/content` is what fixed that: create, edit,
  reorder, enable/disable and draft/publish for `HomepageSection`, with the
  storefront read path (`getPublishedHomepageSections`) still reading
  `config` and never `draftConfig`, so an unpublished edit has no path to a
  visitor.
- **`search` is Postgres-backed** behind a provider interface, so a real
  search service can replace it without touching `catalog`.

Every admin section now has a screen of its own, and the shared "this
section is being built" placeholder at `/admin/[section]` is gone with the
last of them. The invariant it used to provide lives in
`lib/admin/nav-config.test.ts`: a slug added to `ADMIN_SECTIONS` without a
route fails the test suite, which is earlier and louder than a placeholder
page nobody would have visited. Every admin URL still runs
`requirePermission` in its own page.

### Enforcement

The graph is not a diagram anyone has to remember — it is the ESLint config,
and CI fails on violation.

| Rule                                       | Prevents                                                   |
| ------------------------------------------ | ---------------------------------------------------------- |
| `boundaries/element-types`                 | any import outside the table above                         |
| `no-restricted-imports` on `@/modules/*/*` | reaching past a module's public surface into its internals |
| `import/no-cycle`                          | circular dependencies                                      |

All three were verified during P01 by writing deliberate violations and
confirming each one fails:

```
catalog importing orders   → boundaries/element-types    ✗ rejected
@/modules/core/db deep     → no-restricted-imports       ✗ rejected
a → b → a                  → import/no-cycle             ✗ rejected
```

Adding a legitimate new dependency means editing `MODULE_DEPENDENCIES` in
`eslint.config.mjs` — a visible, reviewable change rather than an import that
quietly appears in a diff.

## Layers inside a module

```
Route / Server Action     validation (Zod) + permission check
        ↓
Service                   business logic — the only place decisions are made
        ↓
Repository (Prisma)       data access, no decisions
```

Business logic lives in services because the same operation is called from more
than one place: the UI, a payment webhook, a scheduled job, a test. One
implementation, not four.

## Server and client boundary

`src/modules/core/env.ts` and `db.ts` start with `import 'server-only'`. A
client component that imports them — directly or through a chain — fails the
build instead of shipping a secret. Verified in P01: the build exits 1 with
`'server-only' cannot be imported from a Client Component module`.

## Data model conventions

- **Money is always an integer in minor units** (halalas for SAR), named
  `...Minor`. Floats never touch a stored amount.
- **Order items carry snapshots** of product name, SKU and price, so an old
  invoice stays correct after the product changes or is deleted.
- **Price and stock live on the variant**, even for a product with no options,
  so there is one pricing path rather than two.
- **Bilingual content is explicit columns** (`nameAr`, `nameEn`), not a
  translation table — both languages are first class.
