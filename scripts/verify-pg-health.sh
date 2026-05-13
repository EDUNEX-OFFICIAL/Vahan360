#!/usr/bin/env bash
# Run on the VPS from repo root (e.g. /opt/vahan360) after fixing V360_POSTGRES_* vs volume.
# See docs/DEPLOY_VPS_WORKFLOW.md section 5.2.
set -euo pipefail
BASE="${V360_BACKEND_HEALTH_BASE:-http://127.0.0.1:3001}"
ADMIN_USER="${V360_VERIFY_ADMIN_USER:-admin}"
ADMIN_PASS="${V360_VERIFY_ADMIN_PASS:-admin123}"
BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

echo "=== GET ${BASE}/api/health/pg ==="
curl -sS "${BASE}/api/health/pg"
echo
echo

echo "=== POST ${BASE}/api/auth/generate-token (${ADMIN_USER}) ==="
code="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "${BASE}/api/auth/generate-token" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}")"
echo "HTTP ${code}"
cat "$BODY_FILE"
echo

if [[ "$code" != "200" ]]; then
  echo "Expected HTTP 200 from generate-token. Fix .env / Postgres per docs/DEPLOY_VPS_WORKFLOW.md §5.2." >&2
  exit 1
fi
