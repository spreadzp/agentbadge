#!/usr/bin/env bash
# SLICE-156-7: cross-chain dogfood — buyer USDC on Base Sepolia,
# seller settles on Arc via Circle Gateway batch rail.
#
#   1. GET /api/pay/gateway/deposit-info   — buyer funding instructions
#   2. crosschain-pay.ts (examples/)       — probe 402 → pick
#      GatewayWalletBatched accept → balance check → EIP-3009 sign
#      against GatewayWallet → PAYMENT-SIGNATURE → poll transfers/:id
#   3. GET /api/pay/gateway/transfers/:id  — terminal state (156-5)
#   4. GET /api/payments/history?wallet=   — sourceChain attribution
#      visible in the spend ledger (156-3)
#
# Env: ENDPOINT (default http://localhost:4021),
#      BUYER_KEY (buyer EOA, funded unified balance on Base Sepolia),
#      PAY_URL (paid route; default /api/eaas/status),
#      PAY_METHOD/PAY_BODY (POST verdict flow override),
#      BUYER_WALLET (optional — prints ledger slice when set).
#
# Prereq: server started with CIRCLE_GATEWAY_ENABLED=1 and the buyer
# has unified-balance USDC (deposit: transfer USDC on Base Sepolia to
# the GatewayWallet from deposit-info output — one-time step).
set -euo pipefail

ENDPOINT="${ENDPOINT:-http://localhost:4021}"
PAY_URL="${PAY_URL:-/api/eaas/status}"

echo "=== cross-chain dogfood @ ${ENDPOINT} ==="
echo "[1] deposit-info (buyer funding instructions):"
curl -sf "${ENDPOINT}/api/pay/gateway/deposit-info" | head -c 600; echo; echo

echo "[2] paid call via gateway-batch (buyer on Base Sepolia):"
OUT="$(bun run examples/crosschain-pay.ts)"
echo "${OUT}" | tail -15

TX="$(echo "${OUT}" | grep -o 'transferId: [0-9a-f-]\{36\}' | cut -d' ' -f2 | head -1)"
if [ -z "${TX}" ]; then
  TX="$(echo "${OUT}" | grep -o '[0-9a-f]\{8\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{12\}' | head -1)"
fi

if [ -n "${TX}" ]; then
  echo; echo "[3] terminal state via transfers/:id:"
  curl -sf "${ENDPOINT}/api/pay/gateway/transfers/${TX}" | head -c 400; echo
else
  echo "[3] sync settle or no transferId — check output above"
fi

if [ -n "${BUYER_WALLET:-}" ]; then
  echo; echo "[4] spend ledger (sourceChain attribution):"
  curl -sf "${ENDPOINT}/api/payments/history?wallet=${BUYER_WALLET}&limit=3" \
    | head -c 500; echo
fi

echo "=== dogfood done — settle tx on Arc explorer ==="
