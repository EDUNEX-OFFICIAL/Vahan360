#!/usr/bin/env bash
# ============================================================================
# manage_monthly_partitions.sh — §9 range-partition operational helper
#
# Creates the next N monthly child partitions for `ingest.job_events` and
# optionally drops partitions older than a configurable retention window.
#
# Usage:
#   DATABASE_URL=postgres://... bash manage_monthly_partitions.sh [--months-ahead N] [--dry-run]
#
# Environment:
#   DATABASE_URL         — required (Postgres DSN)
#   MONTHS_AHEAD         — how many future monthly partitions to ensure exist (default: 3)
#   RETENTION_MONTHS     — drop partitions older than N months (default: 0 = never drop)
#   DRY_RUN              — "1" or "true" → print SQL only, do not execute
#   PARTITION_TABLE      — parent table (default: "ingest.job_events")
#   PARTITION_PREFIX     — child table prefix (default: "ingest.job_events_y")
#
# Designed to be run as a Kubernetes CronJob (see manage_monthly_partitions.cronjob.yaml).
# ============================================================================

set -euo pipefail

DB_URL="${DATABASE_URL:?DATABASE_URL is required}"
MONTHS_AHEAD="${MONTHS_AHEAD:-3}"
RETENTION_MONTHS="${RETENTION_MONTHS:-0}"
DRY_RUN="${DRY_RUN:-0}"
PARTITION_TABLE="${PARTITION_TABLE:-ingest.job_events}"
PARTITION_PREFIX="${PARTITION_PREFIX:-ingest.job_events_y}"

function log_info()  { echo "[INFO]  $(date -u +%FT%TZ) $*"; }
function log_warn()  { echo "[WARN]  $(date -u +%FT%TZ) $*" >&2; }
function log_error() { echo "[ERROR] $(date -u +%FT%TZ) $*" >&2; }

function run_sql() {
  local sql="$1"
  if [[ "${DRY_RUN}" == "1" || "${DRY_RUN}" == "true" ]]; then
    echo "[DRY-RUN SQL] ${sql}"
  else
    psql "${DB_URL}" -c "${sql}"
  fi
}

function ensure_partition_for_month() {
  local year="$1"
  local month="$2"
  local next_year next_month

  if [[ "${month}" -eq 12 ]]; then
    next_year=$((year + 1))
    next_month=1
  else
    next_year=${year}
    next_month=$((month + 1))
  fi

  local child_name="${PARTITION_PREFIX}${year}m$(printf '%02d' "${month}")"
  local range_from
  local range_to
  range_from=$(printf '%04d-%02d-01' "${year}" "${month}")
  range_to=$(printf '%04d-%02d-01' "${next_year}" "${next_month}")

  log_info "Ensuring partition: ${child_name} FOR VALUES FROM ('${range_from}') TO ('${range_to}')"
  run_sql "CREATE TABLE IF NOT EXISTS ${child_name} PARTITION OF ${PARTITION_TABLE} FOR VALUES FROM ('${range_from}') TO ('${range_to}');"
}

function drop_partition_for_month() {
  local year="$1"
  local month="$2"
  local child_name="${PARTITION_PREFIX}${year}m$(printf '%02d' "${month}")"

  log_warn "Dropping old partition: ${child_name}"
  run_sql "DROP TABLE IF EXISTS ${child_name};"
}

# ---- Main ----
log_info "Starting partition management (MONTHS_AHEAD=${MONTHS_AHEAD}, RETENTION_MONTHS=${RETENTION_MONTHS})"

# Ensure next N monthly partitions exist
for (( i = 0; i < MONTHS_AHEAD; i++ )); do
  if command -v date >/dev/null 2>&1 && date --version 2>&1 | grep -q GNU; then
    # GNU date
    target_date=$(date -u -d "+${i} months" +%Y-%m-01 2>/dev/null || date -u -v "+${i}m" +%Y-%m-01)
  else
    # macOS / BSD date
    target_date=$(date -u -v "+${i}m" +%Y-%m-01)
  fi
  year="${target_date:0:4}"
  month="${target_date:5:2}"
  ensure_partition_for_month "${year#0}" "${month#0}"
done

# Drop old partitions if retention is configured
if [[ "${RETENTION_MONTHS}" -gt 0 ]]; then
  log_info "Dropping partitions older than ${RETENTION_MONTHS} months"
  # Build list by going back RETENTION_MONTHS+1 months and dropping older ones
  # (conservative: stop at 36 months of history max)
  for (( j = RETENTION_MONTHS + 1; j <= RETENTION_MONTHS + 36; j++ )); do
    if command -v date >/dev/null 2>&1 && date --version 2>&1 | grep -q GNU; then
      target_date=$(date -u -d "-${j} months" +%Y-%m-01 2>/dev/null || date -u -v "-${j}m" +%Y-%m-01)
    else
      target_date=$(date -u -v "-${j}m" +%Y-%m-01)
    fi
    year="${target_date:0:4}"
    month="${target_date:5:2}"
    child_name="${PARTITION_PREFIX}${year}m$(printf '%02d' "${month}")"
    # Only drop if table actually exists (psql IF EXISTS is safe)
    drop_partition_for_month "${year#0}" "${month#0}"
  done
fi

log_info "Partition management complete."
