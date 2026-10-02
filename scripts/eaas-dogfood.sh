#!/usr/bin/env bash
# SLICE-154-7: EaaS dogfood run — full loop on a live server.
#
#   1. GET /api/eaas/status          — SLA snapshot before
#   2. eaas-client requestVerdict    — x402-paid readiness-scan of OUR OWN
#      public API (self-verification dogfood) or deliverable-present
#   3. offline EIP-712 verify        — inside eaas-client (no server trust)
#   4. GET /api/eaas/verdicts/:id/verify — onchain memo-anchor check
#   5. GET /api/eaas/feed?wallet=    — pull-feed shows our verdict
#   6. GET /api/eaas/stats           — counters bumped
#
# Env: ENDPOINT (default http://localhost:4021), EAAS_WALLET_KEY (x402 payer),
#      SCAN_URL (readiness-scan target, default https://agentbadge.xyz).
set -euo pipefail

ENDPOINT="${ENDPOINT:-http://localhost:4021}"
SCAN_URL="${SCAN_URL:-https://agentbadge.xyz}"

echo "=== EaaS dogfood @ ${ENDPOINT} ==="
echo "[1] status before:"
curl -sf "${ENDPOINT}/api/eaas/status" | head -c 400; echo

echo "[2] paid verdict — readiness-scan of our own API (${SCAN_URL})"
OUT="$(bun run examples/eaas-client.ts --endpoint "${ENDPOINT}" \
        --policy readiness-scan --scan-url "${SCAN_URL}")"
echo "${OUT}" | tail -12

VERDICT_ID="$(echo "${OUT}" | grep -o 'verdicts/0x[0-9a-f]\{64\}' | head -1 | cut -d/ -f2)"
if [ -z "${VERDICT_ID}" ]; then echo "✗ no verdictId — payment failed?"; exit 1; fi

echo "[3] offline verify: $(echo "${OUT}" | grep -o 'Offline verify: .*')"

echo "[4] onchain anchor verify:"
curl -sf "${ENDPOINT}/api/eaas/verdicts/${VERDICT_ID}/verify" | head -c 400; echo

WALLET="${EAAS_WALLET:-}"
if [ -n "${WALLET}" ]; then
  echo "[5] pull feed:"
  curl -sf "${ENDPOINT}/api/eaas/feed?wallet=${WALLET}&limit=5" | head -c 400; echo
fi

echo "[6] stats after:"
curl -sf "${ENDPOINT}/api/eaas/stats" | head -c 400; echo
echo "=== dogfood done ==="
