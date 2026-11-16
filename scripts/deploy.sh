#!/usr/bin/env bash
#
# Deploy to Fly.io with build-args (APP_VERSION, GIT_COMMIT, BUILD_DATE).
#
# Usage:
#   ./scripts/deploy.sh          # deploy with auto-detected values
#   bun run deploy               # same via package.json
#
# Auto-detects:
#   APP_VERSION  — from package.json "version" field
#   GIT_COMMIT   — from git rev-parse --short HEAD
#   BUILD_DATE   — current UTC date (YYYY-MM-DD)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# ── Auto-detect build-args ──────────────────────────────────────────

APP_VERSION="${APP_VERSION:-$(node -p "require('./package.json').version")}"
GIT_COMMIT="${GIT_COMMIT:-$(git rev-parse --short HEAD)}"
BUILD_DATE="${BUILD_DATE:-$(date -u +%Y-%m-%d)}"

echo "Deploying with:"
echo "  APP_VERSION=${APP_VERSION}"
echo "  GIT_COMMIT=${GIT_COMMIT}"
echo "  BUILD_DATE=${BUILD_DATE}"
echo ""

# ── Sync prisma migration assets → tracked deploy/database/ ─────────
# Migrations run on the fly release machine from /app/deploy/database
# (see fly.toml release_command). The dir is COMMITTED — CI checkouts must
# carry it too, so commit the diff after syncing schema/migration changes.
DEPLOY_DB="deploy/database"
if [ -d "../../packages/database" ]; then
  mkdir -p "$DEPLOY_DB/src"
  # prisma db migrate needs the full emit output (contract.prisma + emitted
  # contract.json/contract.d.ts/db.ts) — sync the whole dir, file-by-file
  # copies kept hitting missing-artifact errors on the release machine.
  rsync -a --delete "../../packages/database/src/prisma/" "$DEPLOY_DB/src/prisma/"
  # Migration graph lives in migrations/: app/<name>/ edges + refs/db.json
  # pointers + snapshots/<hash>/ contract snapshots. Without it prisma sees
  # an empty graph and fails with MIGRATION.MARKER_MISMATCH.
  rsync -a --delete "../../packages/database/migrations/" "$DEPLOY_DB/migrations/"
  rsync -a "../../packages/database/package.json" "$DEPLOY_DB/"
  cat > "$DEPLOY_DB/prisma.config.ts" <<'EOF'
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './src/prisma/contract.prisma',
    db: { connection: process.env['DIRECT_URL'] ?? process.env['DATABASE_URL']! },
  }),
});
EOF
fi

# ── Deploy ──────────────────────────────────────────────────────────

exec fly deploy \
  --build-arg "APP_VERSION=${APP_VERSION}" \
  --build-arg "GIT_COMMIT=${GIT_COMMIT}" \
  --build-arg "BUILD_DATE=${BUILD_DATE}" \
  "$@"
