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

# ── Vendor file: workspace deps ─────────────────────────────────────
# package.json references ../../packages/* via file: links, but the Docker
# build context is hackathon/server — those paths don't exist inside it.
# Vendor the needed packages into .docker-packages/; the Dockerfile copies
# them to /packages/* so `file:../../packages/x` resolves correctly.
VENDOR_DIR=".docker-packages"
rm -rf "$VENDOR_DIR"
for pkg in a2a payment-forensics; do
  src="../../packages/$pkg"
  if [ -d "$src" ]; then
    mkdir -p "$VENDOR_DIR"
    rsync -a --delete --exclude node_modules --exclude .git --exclude '*.tsbuildinfo' --exclude graphify-out --exclude tests \
      "$src/" "$VENDOR_DIR/$pkg/"
  fi
done

# DB migrations for fly release_command (TCP 5432 is firewalled on dev net;
# the release machine reaches db.prisma.io). Prisma CLI is fetched by bunx.
if [ -d "../../packages/database" ]; then
  mkdir -p "$VENDOR_DIR/database/src/prisma"
  # prisma db migrate needs the full emit output (contract.prisma + emitted
  # contract.json/contract.d.ts/db.ts) — vendor the whole dir, file-by-file
  # copies kept hitting missing-artifact errors on the release machine.
  rsync -a "../../packages/database/src/prisma/" "$VENDOR_DIR/database/src/prisma/"
  # Migration graph lives in migrations/: app/<name>/ edges + refs/db.json
  # pointers + snapshots/<hash>/ contract snapshots. Without it prisma sees
  # an empty graph and fails with MIGRATION.MARKER_MISMATCH.
  rsync -a --delete "../../packages/database/migrations/" "$VENDOR_DIR/database/migrations/"
  rsync -a "../../packages/database/package.json" "$VENDOR_DIR/database/"
  cat > "$VENDOR_DIR/database/prisma.config.ts" <<'EOF'
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
