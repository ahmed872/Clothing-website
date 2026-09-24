# Backup and recovery

"Backups are enabled" is not a backup strategy. A backup counts only if someone
has restored from it and knows how long that takes. This document defines what
is backed up, how to restore, and how the restore is proven to work.

## What must survive

| Data                                             | Where                        | Recoverable from                      |
| ------------------------------------------------ | ---------------------------- | ------------------------------------- |
| Orders, customers, catalog, inventory, audit log | PostgreSQL                   | provider PITR + nightly dump          |
| Product images and uploads                       | object storage (P04)         | storage versioning + lifecycle policy |
| Application code and migrations                  | git                          | the repository                        |
| Secrets                                          | Vercel environment variables | password manager, never in git        |

The database is the only irreplaceable one: code is in git and images can be
re-uploaded, but a lost order cannot be reconstructed.

## Targets

- **RPO (how much data may be lost): 5 minutes.** Met by point-in-time
  recovery on the managed database, not by the nightly dump.
- **RTO (how long a restore may take): 1 hour.** Measured from the decision to
  restore, not from when the incident started.

## Layer 1 — managed point-in-time recovery

Configured once in the database provider's dashboard (ADR-024 puts the database
on a managed provider alongside Vercel):

- Point-in-time recovery: **enabled**
- Retention: **7 days minimum**, 30 preferred
- Region: same as the deployment region

This covers the common disasters: a bad migration, an accidental mass update, a
deletion nobody noticed for an hour.

> Provider settings live in the store owner's account and cannot be set from
> this repository. Until they are confirmed enabled, the platform has layer 2
> only — see "Status" below.

## Layer 2 — independent nightly dump

Provider snapshots live in the same account as the database. If that account is
lost or compromised, so are they. `scripts/backup.sh` produces a compressed
`pg_dump` archive that can be stored anywhere else:

```bash
./scripts/backup.sh                    # writes ./backups/luxedrive-<timestamp>.dump
BACKUP_DIR=/mnt/backups ./scripts/backup.sh
```

The script uses `pg_dump --format=custom`, which restores selectively (a single
table if that is all that was lost) rather than all-or-nothing.

## Restoring

**From the nightly dump, into a scratch database first — never straight over a
live one:**

```bash
createdb luxedrive_restore
pg_restore --dbname=luxedrive_restore --clean --if-exists backups/luxedrive-<timestamp>.dump

# Verify before switching anything:
psql luxedrive_restore -c "SELECT count(*) FROM orders;"
psql luxedrive_restore -c "SELECT max(placed_at) FROM orders;"
psql luxedrive_restore -c "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1;"
```

Only after those numbers look right does the application get pointed at the
restored database by changing `DATABASE_URL`.

**From provider PITR:** restore to a new instance at the chosen timestamp, run
the same three verification queries, then repoint `DATABASE_URL`. Never restore
in place over the running database — if the timestamp was wrong, the only
remaining copy is gone.

## The restore drill

A backup that has never been restored is a hypothesis.

**Quarterly, and after any schema change large enough to need a data
migration:**

1. Take a fresh dump with `scripts/backup.sh`.
2. Restore it into a scratch database as above.
3. Run the three verification queries; record the row counts.
4. Point a local application instance at the restored database and load one
   order end to end.
5. Record the date and the wall-clock duration in the table below.

If step 4 fails, the backup did not work, regardless of what the dump file
looked like.

| Date                    | Dump size | Restore duration | Result                                                                          | Run by           |
| ----------------------- | --------- | ---------------- | ------------------------------------------------------------------------------- | ---------------- |
| 2026-08-31 (P01, local) | 88 KB     | < 1s             | passed — 36 tables, seeded row present, migration record intact                 | P01 verification |
| 2026-09-04 (P14, local) | 152 KB    | ~2s              | passed — 38 tables, 7 orders, 43 users, 245 audit rows, latest migration intact | P14 verification |

The P01 drill ran against the local development database: a row was inserted,
`scripts/backup.sh` produced a dump, the dump was restored into a scratch
database, and the three verification queries confirmed the schema, the row and
the migration history all came back.

The P14 drill re-ran the whole procedure against the schema as it stands
after P02–P13 — 38 tables now rather than P01's 36, carrying real orders,
customers, payments, audit entries and outbox events rather than one seeded
row. `scripts/backup.sh` produced and self-verified a 152 KB custom-format
dump; `pg_restore --clean --if-exists` restored it into a scratch database in
about two seconds; the three documented verification queries came back with
38 tables, 7 orders, the correct latest `placed_at`, and
`20260904111744_outbox_sending_status` as the last applied migration.

Step 4 was run as far as this environment allows: rather than repointing the
running application, a process was pointed at the restored database with the
real `DATABASE_URL` and asked to load one order through the actual domain
query the account page uses (`getOrderForCustomer`), which returned the order
with its status triple, both line items and a `175000` SAR total. That
exercises Prisma, the generated client and the order query against restored
data — everything except the HTTP layer in front of it.

Both drills prove the script and the procedure work. Neither proves anything
about the production instance, which is what the first post-deployment drill
is for.

## Status

| Layer                 | State                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------- |
| Nightly dump script   | ready — `scripts/backup.sh`, verified locally in P01 and again in P14                         |
| Restore procedure     | documented above, verified locally in P01 and again in P14 against the full P13 schema        |
| Provider PITR         | **not yet enabled** — requires the production database, which does not exist until deployment |
| Scheduled nightly run | **not yet scheduled** — needs the production host                                             |
| Restore drill         | **not yet performed** — needs a production database to drill against                          |

The three open items are deployment tasks, not code tasks — every one of them
needs a production database that does not exist yet. They are the first items
of the deployment step. P14's audit re-checked them and could not close them
for that reason; nothing about them is blocked on code.
