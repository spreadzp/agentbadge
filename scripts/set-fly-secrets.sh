#!/usr/bin/env bash
#
# Set Fly.io secrets from local .env file.
#
# Usage:
#   chmod +x scripts/set-fly-secrets.sh
#   ./scripts/set-fly-secrets.sh
#
# Reads .env, extracts only the variables needed for production,
# and calls `flyctl secrets set` for each one.
#
# Safety:
# - Never prints secret values to terminal
# - Only exports whitelisted variables (not all .env entries)
# - Validates that flyctl is installed and authenticated
# - Validates that .env exists and has all required keys

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"

# ── Whitelist of secrets to push to Fly.io ───────────────────────────
SECRETS=(
  BASE_URL
  HEDERA_NETWORK
  HEDERA_OPERATOR_ID
  HEDERA_OPERATOR_KEY
  PASSPORT_TOKEN_ID
  AUDIT_TOPIC_ID
  DIRECTORY_TOPIC_ID
  x402_FACILITATOR_URL
  x402_FEE_PAYER
  x402_TREASURY
  IPFS_API_KEY
  IPFS_API_SECRET
  PLAUSIBLE_ENABLED
  PLAUSIBLE_DOMAIN
  TELEGRAM_BOT_TOKEN
  TELEGRAM_CHAT_ID
  L402_ROOT_KEY
  L402_TEST_MODE
  L402_AMOUNT_SATS
  L402_NODE_PUBKEY
)

# Optional secrets (set if present in .env, skip silently if missing)
OPTIONAL_SECRETS=(
  SENTRY_DSN
)

# ── Colors ───────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[info]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
error() { echo -e "${RED}[error]${NC} $*"; exit 1; }

# ── Pre-flight checks ────────────────────────────────────────────────

# Add flyctl to PATH if installed in default location
export PATH="$HOME/.fly/bin:$PATH"

command -v flyctl >/dev/null 2>&1 || error "flyctl not found. Install: curl -L https://fly.io/install.sh | sh"

flyctl auth whoami >/dev/null 2>&1 || error "Not authenticated. Run: flyctl auth login"

[ -f "$ENV_FILE" ] || error ".env not found at: $ENV_FILE"

# ── Parse .env (strip quotes, ignore comments and empty lines) ───────

parse_env() {
  local file="$1"
  # Read line by line, skip comments (#) and empty lines
  while IFS='=' read -r key value || [ -n "$key" ]; do
    # Skip comments and empty lines
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$key" ]] && continue
    # Trim whitespace
    key="$(echo "$key" | xargs)"
    # Skip if value is empty
    [[ -z "$value" ]] && continue
    # Strip surrounding quotes (single or double)
    value="${value#\"}"
    value="${value%\"}"
    value="${value#\'}"
    value="${value%\'}"
    # Trim trailing whitespace/CR
    value="$(echo "$value" | tr -d '\r' | xargs)"
    # Export for flyctl
    export "$key=$value"
  done < "$file"
}

info "Parsing .env..."
parse_env "$ENV_FILE"

# ── Validate all required keys are present ────────────────────────────

missing=0
for key in "${SECRETS[@]}"; do
  if [ -z "${!key:-}" ]; then
    warn "Missing: $key"
    missing=$((missing + 1))
  fi
done

if [ "$missing" -gt 0 ]; then
  error "$missing required secret(s) missing from .env. Fix and re-run."
fi

info "All ${#SECRETS[@]} required secrets found in .env."

# Report optional secrets
for key in "${OPTIONAL_SECRETS[@]}"; do
  if [ -n "${!key:-}" ]; then
    info "Optional: $key found"
  else
    warn "Optional: $key not set (skipped)"
  fi
done

# ── Confirm before pushing ────────────────────────────────────────────

echo ""
echo "About to set these secrets on Fly.io:"
for key in "${SECRETS[@]}"; do
  echo "  - $key (required)"
done
for key in "${OPTIONAL_SECRETS[@]}"; do
  if [ -n "${!key:-}" ]; then
    echo "  - $key (optional, present)"
  fi
done
echo ""
read -rp "Proceed? (yes/no): " confirm
[[ "$confirm" == "yes" ]] || { echo "Aborted."; exit 0; }

# ── Push secrets to Fly.io ────────────────────────────────────────────

info "Setting secrets on Fly.io..."
echo ""

# Required secrets
for key in "${SECRETS[@]}"; do
  value="${!key}"
  # Use --stage to batch all secrets in one deployment
  if flyctl secrets set --stage "$key=$value" 2>/dev/null; then
    info "  ✓ $key"
  else
    # Fallback: without --stage (immediate)
    if flyctl secrets set "$key=$value" 2>/dev/null; then
      info "  ✓ $key (immediate)"
    else
      error "  ✗ Failed to set $key"
    fi
  fi
done

# Optional secrets (only if present)
for key in "${OPTIONAL_SECRETS[@]}"; do
  if [ -z "${!key:-}" ]; then
    warn "  ○ $key skipped (not set)"
    continue
  fi
  value="${!key}"
  if flyctl secrets set --stage "$key=$value" 2>/dev/null; then
    info "  ✓ $key (optional)"
  else
    if flyctl secrets set "$key=$value" 2>/dev/null; then
      info "  ✓ $key (optional, immediate)"
    else
      warn "  ✗ Failed to set $key (optional, skipped)"
    fi
  fi
done

echo ""
info "All secrets staged. Deploy to apply:"
echo ""
echo "  flyctl deploy"
echo ""
