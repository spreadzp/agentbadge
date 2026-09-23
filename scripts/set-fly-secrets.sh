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
  GA4_ENABLED
  GA4_MEASUREMENT_ID
  GOOGLE_SITE_VERIFICATION
  TELEGRAM_BOT_TOKEN
  TELEGRAM_CHAT_ID
  L402_ROOT_KEY
  L402_TEST_MODE
  L402_AMOUNT_SATS
  L402_NODE_PUBKEY
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  STRIPE_PUBLISHABLE_KEY
  PUBLIC_BASE_URL
)

# Optional secrets (set if present in .env, skip silently if missing)
OPTIONAL_SECRETS=(
  SENTRY_DSN
  SOURCE_COMMIT
  BUILD_DATE
  ATTESTCOIN_ENABLED
  TASK_ESCROW_SEPOLIA_ADDR
  TASK_MARKETPLACE_ASC_ADDR
  TASK_STATE_ADDR
  SEPOLIA_RPC_URL
  CREDITCOIN_RPC_URL
  ATTESTCOIN_PROVER_URL
  KEEPERHUB_API_KEY
  KEEPERHUB_WEBHOOK_KEY
  KEEPERHUB_API_BASE_URL
  KEEPERHUB_MCP_SERVER_URL
  KEEPERHUB_WORKFLOW_RECORD_SCAN
  KEEPERHUB_WORKFLOW_MINT_PASSPORT
  KEEPERHUB_WORKFLOW_NOTIFY
  KEEPERHUB_REGISTRY_ADDRESS
  KEEPERHUB_BADGE_ADDRESS
  BASE_PASSPORT_NFT
  BASE_ESCROW_ADDRESS
  BASE_USDC_ADDRESS
  BASE_EVENT_LOG_ADDRESS
  DATABASE_ENABLED
  DATABASE_URL
  # NOTE: DIRECT_URL is intentionally NOT whitelisted — it is the unpooled
  # migration URL and stays local in .env.deployer (see packages/database/RUNBOOK.md)

  # ── bStock delta tracker (EPIC-141) ──
  BSTOCK_ENABLED
  BSTOCK_FEED_ENABLED
  BSTOCK_SERVICE_ID
  BSTOCK_SELLER_PASSPORT_ID
  BSTOCK_PRICE_USD
  BSTOCK_PASS_DURATION_SEC
  BSTOCK_RATE_LIMIT_PER_MIN
  BSTOCK_MAX_SSE_CONNECTIONS
  BSTOCK_TG_PUSH_ENABLED
  MCP_AGENT_TOKENS
  FINNHUB_API_KEY
  ALPACA_API_KEY
  ALPACA_API_SECRET
  TELEGRAM_BOT_BSTOK_TOKEN
  X402_PAY_TO
  X402_USDC_ADDRESS
  # .env keeps BSTOK-infix names; pushed under canonical names via SECRET_RENAME
  BINANCE_BSTOK_API_KEY
  BINANCE_BSTOK_API_SECRET
  # ── Cache layer (EPIC-144/145) ──
  CACHE_ENABLED
  CACHE_BACKEND
  CACHE_URL
  CACHE_TOKEN
)

# .env name → Fly secret name (when they differ)
declare -A SECRET_RENAME=(
  [BINANCE_BSTOK_API_KEY]="BINANCE_API_KEY"
  [BINANCE_BSTOK_API_SECRET]="BINANCE_API_SECRET"
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
  fly_key="${SECRET_RENAME[$key]:-$key}"
  # Use --stage to batch all secrets in one deployment
  if flyctl secrets set --stage "$fly_key=$value" 2>/dev/null; then
    info "  ✓ $fly_key"
  else
    # Fallback: without --stage (immediate)
    if flyctl secrets set "$fly_key=$value" 2>/dev/null; then
      info "  ✓ $fly_key (immediate)"
    else
      error "  ✗ Failed to set $fly_key"
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
  fly_key="${SECRET_RENAME[$key]:-$key}"
  if flyctl secrets set --stage "$fly_key=$value" 2>/dev/null; then
    info "  ✓ $fly_key (optional)"
  else
    if flyctl secrets set "$fly_key=$value" 2>/dev/null; then
      info "  ✓ $fly_key (optional, immediate)"
    else
      warn "  ✗ Failed to set $fly_key (optional, skipped)"
    fi
  fi
done

echo ""
info "All secrets staged. Deploy to apply:"
echo ""
echo "  flyctl deploy"
echo ""
