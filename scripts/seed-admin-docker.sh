#!/usr/bin/env bash
# Apply Prisma schema to Postgres and upsert default admin (admin / admin123).
# Run from repo root on the VPS (or anywhere with docker compose and this repo).
set -euo pipefail
REPO_DIR="${DEPLOY_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO_DIR"
docker compose run --rm api-express npx prisma db push
docker compose run --rm api-express npm run sync:user
echo "Health check (expect userCount >= 1):"
curl -sS "http://127.0.0.1:3001/api/health/pg" || true
