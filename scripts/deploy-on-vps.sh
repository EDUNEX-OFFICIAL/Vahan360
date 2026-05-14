#!/usr/bin/env bash
# Run on the VPS (same commands as GitHub Actions deploy). Repo path must match workflow.
set -euo pipefail
REPO_DIR="${DEPLOY_REPO_DIR:-/opt/vahan360}"
cd "$REPO_DIR"
git config --global --add safe.directory "$REPO_DIR" 2>/dev/null || true
git pull origin main
# After compose service renames, old containers can hold ports (e.g. 3001) until removed
docker compose down --remove-orphans || true
docker compose up -d --build
docker compose ps
