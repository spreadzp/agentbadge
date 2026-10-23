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
    rsync -a --delete --exclude node_modules --exclude .git --exclude '*.tsbuildinfo' \
      "$src/" "$VENDOR_DIR/$pkg/"
  fi
done

# ── Deploy ──────────────────────────────────────────────────────────

exec fly deploy \
  --build-arg "APP_VERSION=${APP_VERSION}" \
  --build-arg "GIT_COMMIT=${GIT_COMMIT}" \
  --build-arg "BUILD_DATE=${BUILD_DATE}" \
  "$@"
