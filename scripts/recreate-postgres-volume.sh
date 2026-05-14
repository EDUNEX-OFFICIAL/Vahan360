#!/usr/bin/env bash
# DESTRUCTIVE: removes Compose-managed volumes (including Postgres data), then brings stack back
# and runs prisma db push + default admin seed. Run only on /opt/vahan360 (or set DEPLOY_REPO_DIR).
set -euo pipefail
REPO_DIR="${DEPLOY_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO_DIR"
echo "WARNING: This runs 'docker compose down --volumes' — all DB data in this project's named volumes will be deleted."
read -r -p "Type YES to continue: " confirm
if [[ "$confirm" != "YES" ]]; then
  echo "Aborted."
  exit 1
fi
docker compose down
docker compose down --volumes
docker compose up -d postgres
echo "Waiting for Postgres..."
sleep 15
docker compose run --rm api-express npx prisma db push
docker compose up -d --build
docker compose run --rm api-express npm run sync:user
echo "Done. Test: curl -sS http://127.0.0.1:3001/api/health/pg"
