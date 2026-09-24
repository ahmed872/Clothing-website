#!/usr/bin/env bash
#
# Nightly logical backup of the LuxeDrive database.
#
# Independent of the provider's own snapshots on purpose: provider snapshots
# live in the same account as the database, so they disappear with it. See
# docs/backup-and-recovery.md for the restore procedure and the drill.
#
# Usage:
#   ./scripts/backup.sh                      # reads DATABASE_URL from .env
#   BACKUP_DIR=/mnt/backups ./scripts/backup.sh
#   RETAIN_DAYS=30 ./scripts/backup.sh

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"

# Load DATABASE_URL from .env when it is not already exported.
if [[ -z "${DATABASE_URL:-}" && -f .env ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "error: DATABASE_URL is not set and could not be read from .env" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "error: pg_dump not found. Install the PostgreSQL client tools." >&2
  exit 1
fi

# Prisma's connection string carries parameters libpq does not understand
# (`schema`, `connection_limit`, `pgbouncer`, ...) and pg_dump refuses the URL
# outright. Keep only the parameters libpq accepts — sslmode in particular,
# which managed providers require.
sanitize_connection_url() {
  local url="$1" base query kept=""
  base="${url%%\?*}"
  query="${url#*\?}"

  if [[ "$query" == "$url" ]]; then
    printf '%s' "$base"
    return
  fi

  local IFS='&'
  for param in $query; do
    case "${param%%=*}" in
      sslmode | sslrootcert | sslcert | sslkey | connect_timeout | application_name)
        kept="${kept:+${kept}&}${param}"
        ;;
    esac
  done

  printf '%s%s' "$base" "${kept:+?${kept}}"
}

DUMP_URL="$(sanitize_connection_url "$DATABASE_URL")"

mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="${BACKUP_DIR}/luxedrive-${timestamp}.dump"

echo "Backing up to ${target}"

# --format=custom so pg_restore can restore selectively (a single table if that
# is all that was lost) instead of all or nothing.
pg_dump \
  --dbname="$DUMP_URL" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="$target"

size="$(du -h "$target" | cut -f1)"
echo "Wrote ${target} (${size})"

# A dump that cannot be listed is not a dump. Fail loudly now rather than
# during an incident.
if ! pg_restore --list "$target" >/dev/null 2>&1; then
  echo "error: the dump could not be read back by pg_restore — treating as failed" >&2
  exit 1
fi
echo "Verified: archive is readable by pg_restore"

deleted="$(find "$BACKUP_DIR" -name 'luxedrive-*.dump' -type f -mtime "+${RETAIN_DAYS}" -print -delete | wc -l)"
if [[ "$deleted" -gt 0 ]]; then
  echo "Pruned ${deleted} backup(s) older than ${RETAIN_DAYS} days"
fi

echo "Backup complete."
