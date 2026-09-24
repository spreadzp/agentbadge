#!/usr/bin/env bash
# SLICE-136-5: Bazaar listing keep-alive.
# CDP Bazaar delists resources with no settle for ~30 days. This cron job makes
# a minimal paid self-call (cheapest pack) and pings the Better Stack heartbeat
# on success/failure — alert fires if no successful settle within 7d (+1d grace).
#
# Crontab (weekly, e.g. Monday 09:00):
#   0 9 * * 1  cd /path/to/hackathon/server && ./scripts/bazaar-keepalive.sh >> /var/log/bazaar-keepalive.log 2>&1
#
# Env: DEMO_WALLET_KEY (Base Sepolia USDC), optionally HEARTBEAT_URL override.

set -u
cd "$(dirname "$0")/.."

HEARTBEAT_URL="${HEARTBEAT_URL:-https://uptime.betterstack.com/api/v1/heartbeat/RHiATMcnWV7h2WnvUqACduZj}"

set -a; source .env; set +a

# Cheapest paid call: single pack instead of full scan
export PACKS="${PACKS:-discovery-crawling}"

echo "[$(date -Is)] bazaar-keepalive: starting paid self-call (packs=$PACKS)"

if bun run scripts/x402-total-scan-settle.mts; then
  echo "[$(date -Is)] settle OK — pinging heartbeat"
  curl -fsS -m 10 "$HEARTBEAT_URL" >/dev/null && echo "heartbeat pinged" || echo "WARN: heartbeat ping failed"
else
  rc=$?
  echo "[$(date -Is)] settle FAILED (rc=$rc) — reporting /fail"
  curl -fsS -m 10 "$HEARTBEAT_URL/fail" >/dev/null || true
  exit $rc
fi
