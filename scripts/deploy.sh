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

# ── Deploy ──────────────────────────────────────────────────────────

exec fly deploy \
  --build-arg "APP_VERSION=${APP_VERSION}" \
  --build-arg "GIT_COMMIT=${GIT_COMMIT}" \
  --build-arg "BUILD_DATE=${BUILD_DATE}" \
  "$@"
